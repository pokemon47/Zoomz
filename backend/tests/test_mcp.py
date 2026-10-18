import base64
import hashlib
import io
import json
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import anyio
import httpx
import pytest
from fastapi import HTTPException
from PIL import Image
from sqlalchemy import select

from app.db import SessionLocal
from app.main import app
from app.mcp_access import clock
from app.mcp_models import McpConnection, McpCredential, McpAudit
from app.mcp_server import Verifier
from app import mcp_service as service
from app.models import Node, SpaceMember
from app.security import hash_token

H = {"X-Zoomz": "1"}
RESOURCE = "http://testserver/mcp"


def connect(owner, grants=None, *, redeem=True):
    registered = owner.post('/api/mcp/oauth/register', json={'client_name': 'SDK test', 'redirect_uris': ['https://client.example/callback']})
    assert registered.status_code == 201, registered.text
    cid = registered.json()['client_id']
    verifier = 'a' * 64
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode()
    response = owner.get('/api/mcp/oauth/authorize', params={'client_id': cid, 'redirect_uri': 'https://client.example/callback', 'code_challenge': challenge,
                         'resource': RESOURCE, 'scope': 'zoomz:read zoomz:edit offline_access', 'state': 'state-checked'}, follow_redirects=False)
    assert response.status_code == 303
    pending = parse_qs(urlsplit(response.headers['location']).query)['request'][0]
    response = owner.post('/api/mcp/consent/' + pending, headers=H, json=grants or {'mode': 'all', 'edit': True})
    assert response.status_code == 200, response.text
    query = parse_qs(urlsplit(response.json()['redirect']).query)
    assert query['state'] == ['state-checked']
    form = {'grant_type': 'authorization_code', 'client_id': cid, 'code': query['code'][0], 'code_verifier': verifier,
            'resource': RESOURCE, 'redirect_uri': 'https://client.example/callback'}
    tokens = owner.post('/api/mcp/oauth/token', data=form) if redeem else None
    if tokens is not None:
        assert tokens.status_code == 200, tokens.text
    with SessionLocal() as db:
        connection = db.scalar(select(McpConnection).where(McpConnection.client_id == cid))
        connection_id = connection.id
    return connection_id, tokens.json() if tokens is not None else {}, form


@pytest.fixture
def setup(make_client):
    owner = make_client(f'mcp-{uuid4().hex}@example.com')
    connection, tokens, form = connect(owner)
    space = owner.get('/api/spaces').json()['mine'][0]['id']
    root = owner.get(f'/api/spaces/{space}/scene').json()['rootBoardId']
    return owner, connection, tokens, form, space, root


def batch(space, root, **kwargs):
    return {'space_id': space, 'idempotency_key': uuid4().hex, 'expected_revision': 0,
            'operations': [{'type': 'create', 'ref': 'note', 'node': {'type': 'note', 'parentId': root, 'x': 42, 'y': 80, 'w': 300, 'h': 210, 'content': {'title': 'Revision', 'body': 'Source summary'}}}], **kwargs}


def test_oauth_tokens_resource_rotation_and_revocation(setup):
    owner, connection, tokens, form, *_ = setup
    async def verify(value):
        return await Verifier().verify_token(value)
    assert anyio.run(verify, tokens['access_token']).resource == RESOURCE
    assert anyio.run(verify, 'wrong') is None
    assert owner.post('/api/mcp/oauth/token', data={**form, 'resource': 'https://other.example/mcp'}).status_code == 400
    refreshed = owner.post('/api/mcp/oauth/token', data={'grant_type': 'refresh_token', 'client_id': form['client_id'], 'refresh_token': tokens['refresh_token'], 'resource': RESOURCE})
    assert refreshed.status_code == 200
    replay = owner.post('/api/mcp/oauth/token', data={'grant_type': 'refresh_token', 'client_id': form['client_id'], 'refresh_token': tokens['refresh_token'], 'resource': RESOURCE})
    assert replay.status_code == 400
    assert anyio.run(verify, refreshed.json()['access_token']) is None


def test_oauth_revocation_is_idempotent(setup):
    owner, _, tokens, form, *_ = setup
    request = {'token': tokens['access_token'], 'client_id': form['client_id']}
    assert owner.post('/api/mcp/oauth/revoke', data=request).status_code == 200
    assert owner.post('/api/mcp/oauth/revoke', data=request).status_code == 200
    assert owner.post('/api/mcp/oauth/revoke', data={**request, 'token': 'unknown'}).status_code == 200
    assert anyio.run(Verifier().verify_token, tokens['access_token']) is None


def test_native_loopback_oauth_callback_in_production(setup, monkeypatch):
    from dataclasses import replace
    from app import mcp_access
    owner, *_ = setup
    monkeypatch.setattr(mcp_access, 'settings', replace(mcp_access.settings, env='production', public_url='https://zoomz.example'))
    for callback in ('http://127.0.0.1:6274/oauth/callback', 'http://[::1]:6274/callback', 'http://localhost:6274/callback'):
        assert owner.post('/api/mcp/oauth/register', json={'redirect_uris': [callback]}).status_code == 201
    for callback in ('http://client.example/callback', 'https://client.example/\ncallback', 'https://client.example/call back'):
        assert owner.post('/api/mcp/oauth/register', json={'redirect_uris': [callback]}).status_code == 400


def test_oauth_consent_csrf_redirects_and_no_secret_leak(setup):
    owner, connection, tokens, form, *_ = setup
    assert owner.post('/api/mcp/oauth/register', json={'redirect_uris': ['javascript:alert(1)']}).status_code == 400
    assert owner.post('/api/mcp/consent/unknown', json={'mode': 'all'}).status_code == 403
    with SessionLocal() as db:
        row = db.get(McpCredential, hash_token(tokens['access_token']))
        row.expires = clock() - 1
        db.commit()
    assert anyio.run(Verifier().verify_token, tokens['access_token']) is None
    result = owner.get('/api/mcp/connections').text
    assert tokens['access_token'] not in result and tokens['refresh_token'] not in result


def test_atomic_geometry_nested_retries_and_conflicts(setup):
    owner, connection, _, _, space, root = setup
    value = batch(space, root)
    value['operations'].insert(0, {'type': 'create', 'ref': 'topic', 'node': {'type': 'board', 'parentId': root, 'x': 10, 'y': 20, 'w': 360, 'h': 330, 'content': {'title': 'Graphs'}}})
    value['operations'][1]['node']['parentId'] = '$topic'
    result = service.apply_batch(connection, value)
    assert service.apply_batch(connection, value) == result
    node = next(n for n in owner.get(f'/api/spaces/{space}/scene').json()['nodes'] if n['id'] == result['ids']['note'])
    assert (node['x'], node['y'], node['w'], node['h']) == (42, 80, 300, 210)
    assert node['parentId'] == result['ids']['topic']
    with pytest.raises(HTTPException, match='Idempotency'):
        service.apply_batch(connection, {**value, 'expected_revision': 9})
    assert service.apply_batch(connection, batch(space, root))['error'] == 'revision_conflict'
    invalid = batch(space, root, expected_revision=1)
    invalid['operations'].append({'type': 'create', 'ref': 'broken', 'node': {'type': 'bad-type', 'parentId': root}})
    with pytest.raises(Exception):
        service.apply_batch(connection, invalid)
    assert owner.get(f'/api/spaces/{space}/scene').json()['seq'] == 1


def test_scope_roles_and_cross_user(setup, make_client):
    owner, _, _, _, space, root = setup
    other = make_client(f'other-{uuid4().hex}@example.com')
    other_conn, _, _ = connect(other)
    with pytest.raises(HTTPException):
        service.get_board(other_conn, space, root)
    with SessionLocal() as db:
        db.add(SpaceMember(space_id=space, user_id=other.me['id'], role='viewer'))
        db.commit()
    assert service.get_board(other_conn, space, root)['board']['id'] == root
    with pytest.raises(HTTPException):
        service.apply_batch(other_conn, batch(space, root))
    read_conn, _, _ = connect(owner, {'mode': 'boards', 'ids': [root], 'edit': False})
    with pytest.raises(HTTPException):
        service.apply_batch(read_conn, batch(space, root))
    other_space = other.get('/api/spaces').json()['mine'][0]['id']
    other_root = other.get(f'/api/spaces/{other_space}/scene').json()['rootBoardId']
    with pytest.raises(HTTPException):
        service.get_board(read_conn, other_space, other_root)


def test_tasks_pause_manual_edits_checkpoints_resume(setup):
    owner, connection, _, _, space, root = setup
    task = service.task_action(connection, 'create', space, root, objective='Revision notes')
    paused = owner.post('/api/mcp/tasks/' + task['id'], headers=H, json={'state': 'paused', 'expected_revision': 0})
    assert paused.status_code == 200
    with pytest.raises(HTTPException):
        service.apply_batch(connection, batch(space, root, task_id=task['id']))
    # Omitting task_id must not bypass a paused draft.
    with pytest.raises(HTTPException):
        service.apply_batch(connection, batch(space, root))
    manual = owner.post(f'/api/spaces/{space}/ops', headers=H, json={'op': {'type': 'create', 'node': {'id': 'manual-' + uuid4().hex, 'type': 'note', 'parentId': root, 'content': {'body': 'Keep my edits'}}}})
    assert manual.status_code == 200
    with pytest.raises(HTTPException):
        service.task_action(connection, 'generating', task_id=task['id'], expected_revision=0)
    service.task_action(connection, 'generating', task_id=task['id'], expected_revision=1)
    saved = service.task_action(connection, 'checkpoint', task_id=task['id'], checkpoint={'summary': 'Graphs complete', 'missing_sources': ['Lecture 2']}, expected_revision=1)
    assert saved['checkpoint']['missing_sources'] == ['Lecture 2']
    second, _, _ = connect(owner)
    assert any(t['id'] == task['id'] for t in service.task_action(second, 'list')['tasks'])
    service.apply_batch(second, batch(space, root, task_id=task['id'], expected_revision=1))
    service.task_action(second, 'completed', task_id=task['id'], expected_revision=2)
    assert any(n['content'].get('body') == 'Keep my edits' for n in owner.get(f'/api/spaces/{space}/scene').json()['nodes'])


def test_destructive_approval_exact_binding_and_retry(setup):
    owner, connection, _, _, space, root = setup
    result = service.apply_batch(connection, batch(space, root))
    remove = batch(space, root, expected_revision=1, operations=[{'type': 'delete', 'id': result['ids']['note']}])
    response = service.apply_batch(connection, remove)
    assert response['error'] == 'approval_required'
    assert owner.post('/api/mcp/approvals/' + response['approval_id'], headers=H).status_code == 200
    modified = {**remove, 'idempotency_key': uuid4().hex}
    assert service.apply_batch(connection, modified)['error'] == 'approval_required'
    done = service.apply_batch(connection, remove)
    assert done['revision'] == 2
    assert service.apply_batch(connection, remove) == done
    snapshots = owner.get('/api/mcp/snapshots').json()['snapshots']
    assert snapshots and owner.get('/api/mcp/snapshots/' + snapshots[0]['id']).status_code == 200


def test_media_sources_and_unsafe_reference(setup):
    owner, connection, _, _, space, root = setup
    image = io.BytesIO()
    Image.new('RGB', (80, 40), 'orange').save(image, 'PNG')
    args = (connection, space, root, 'diagram.png', base64.b64encode(image.getvalue()).decode(), 'media-key', 0, 10, 20, 240, 160)
    stored = service.upload_media(*args)
    assert service.upload_media(*args) == stored
    visual = service.get_source_visual(connection, space, stored['file_id'])
    assert visual['metadata']['page_count'] == 1
    with Image.open(io.BytesIO(visual['image'])) as rendered:
        assert rendered.width / rendered.height == 2
    assert owner.get('/api/mcp/sources/' + stored['file_id']).status_code == 200
    value = batch(space, root, expected_revision=1)
    value['operations'][0]['node']['content']['references'] = [{'asset_id': stored['file_id'], 'page': 2, 'classification': 'source', 'availability': 'available'}]
    result = service.apply_batch(connection, value)
    node = next(n for n in owner.get(f'/api/spaces/{space}/scene').json()['nodes'] if n['id'] == result['ids']['note'])
    assert node['content']['references'][0]['page'] == 2
    bad = batch(space, root, expected_revision=2)
    bad['operations'][0]['node']['content']['references'] = [{'url': 'javascript:alert(1)', 'classification': 'external'}]
    with pytest.raises(Exception):
        service.apply_batch(connection, bad)


def test_source_visual_pdf_pages_and_scope(setup, make_client):
    owner, connection, tokens, _, space, root = setup
    pages = [Image.new('RGB', (240, 160), color) for color in ('orange', 'blue')]
    document = io.BytesIO()
    pages[0].save(document, 'PDF', save_all=True, append_images=pages[1:])
    stored = service.upload_media(connection, space, root, 'lecture.pdf', base64.b64encode(document.getvalue()).decode(),
                                 'lecture-pdf', 0, 0, 0, 300, 200)
    for number in (1, 2):
        visual = service.get_source_visual(connection, space, stored['file_id'], number)
        assert visual['metadata']['page'] == number
        assert visual['metadata']['page_count'] == 2
        with Image.open(io.BytesIO(visual['image'])) as image:
            assert image.format == 'JPEG'
            assert max(image.size) <= 1600
            assert image.width / image.height == pytest.approx(1.5, rel=.01)
    with pytest.raises(HTTPException): service.get_source_visual(connection, space, stored['file_id'], 3)
    other = make_client(f'source-reader-{uuid4().hex}@example.com')
    outsider, _, _ = connect(other)
    with pytest.raises(HTTPException): service.get_source_visual(outsider, space, stored['file_id'], 1)
    child = service.apply_batch(connection, batch(space, root, expected_revision=1,
        operations=[{'type': 'create', 'ref': 'child', 'node': {'type': 'board', 'parentId': root}}]))['ids']['child']
    scoped, _, _ = connect(owner, {'mode': 'boards', 'ids': [child], 'edit': False})
    with pytest.raises(HTTPException): service.get_source_visual(scoped, space, stored['file_id'], 1)

    async def inspect_over_protocol():
        from mcp import ClientSession
        from mcp.client.streamable_http import streamable_http_client
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), headers={'Authorization': 'Bearer ' + tokens['access_token']}) as http:
            async with streamable_http_client(RESOURCE, http_client=http) as (read, write, _):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    result = await session.call_tool('get_source_visual', {'space_id': space, 'file_id': stored['file_id'], 'page': 2})
                    assert not result.isError
                    assert result.structuredContent['page'] == 2
                    assert any(block.type == 'image' and block.mimeType == 'image/jpeg' for block in result.content)
    anyio.run(inspect_over_protocol)


def test_real_sdk_protocol_and_tool_call(setup):
    _, _, tokens, _, space, root = setup
    async def run():
        from mcp import ClientSession
        from mcp.client.streamable_http import streamable_http_client
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), headers={'Authorization': 'Bearer ' + tokens['access_token']}) as http:
            async with streamable_http_client(RESOURCE, http_client=http) as (read, write, _):
                async with ClientSession(read, write) as session:
                    result = await session.initialize()
                    assert result.serverInfo.name == 'Zoomz'
                    tools = await session.list_tools()
                    assert 'apply_canvas_batch' in {t.name for t in tools.tools}
                    readback = await session.call_tool('get_board', {'space_id': space, 'board_id': root})
                    assert not readback.isError
                    assert readback.structuredContent['board']['id'] == root
    anyio.run(run)


def test_mcp_rejects_missing_and_invalid_bearers(setup):
    owner, *_ = setup
    assert owner.post('/mcp', json={'jsonrpc': '2.0', 'id': 1, 'method': 'initialize'}).status_code == 401
    assert owner.post('/mcp', headers={'Authorization': 'Bearer invalid'}, json={}).status_code == 401


@pytest.mark.parametrize('change', [{'grant_type': 'refresh_token'}, {'code_verifier': 'b' * 64}, {'redirect_uri': 'https://attacker.example/callback'}])
def test_invalid_redeemed_code_replay_does_not_revoke(setup, change):
    owner, connection, tokens, form, *_ = setup
    response = owner.post('/api/mcp/oauth/token', data={**form, **change, 'refresh_token': form['code']})
    assert response.status_code == 400
    assert anyio.run(Verifier().verify_token, tokens['access_token']) is not None


@pytest.mark.parametrize('policy', ['approve', 'block'])
@pytest.mark.parametrize('replacement', ['unrelated ' * 200, 'unrelated ' * 100])
def test_substantial_equal_and_half_length_replacement_is_destructive(setup, policy, replacement):
    owner, connection, _, _, space, root = setup
    value = batch(space, root)
    value['operations'][0]['node']['content']['body'] = 'original ' * 220
    made = service.apply_batch(connection, value)
    assert owner.put('/api/mcp/connections/' + connection, headers=H, json={'mode': 'all', 'edit': True, 'destructive': policy}).status_code == 200
    update = batch(space, root, expected_revision=1, operations=[{'type': 'update', 'id': made['ids']['note'], 'patch': {'content': {'body': replacement}}}])
    if policy == 'block':
        with pytest.raises(HTTPException): service.apply_batch(connection, update)
    else:
        assert service.apply_batch(connection, update)['error'] == 'approval_required'


def test_scope_narrowing_and_stale_approval(setup):
    owner, connection, _, _, space, root = setup
    made = service.apply_batch(connection, batch(space, root))
    remove = batch(space, root, expected_revision=1, operations=[{'type': 'delete', 'id': made['ids']['note']}])
    approval = service.apply_batch(connection, remove)
    owner.post('/api/mcp/approvals/' + approval['approval_id'], headers=H)
    service.apply_batch(connection, batch(space, root, expected_revision=1))
    assert service.apply_batch(connection, remove)['error'] == 'revision_conflict'
    owner.put('/api/mcp/connections/' + connection, headers=H, json={'mode': 'all', 'edit': False})
    with pytest.raises(HTTPException): service.apply_batch(connection, remove)


def test_atomic_concurrent_retry(setup):
    from concurrent.futures import ThreadPoolExecutor
    _, connection, _, _, space, root = setup
    value = batch(space, root)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: service.apply_batch(connection, value), range(2)))
    assert results[0] == results[1]
    with SessionLocal() as db:
        assert db.get(Node, results[0]['ids']['note']) is not None
        assert db.get(__import__('app.models', fromlist=['Space']).Space, space).seq == 1


@pytest.mark.parametrize('via', ['browser', 'mcp'])
def test_pause_serializes_with_inflight_batch(setup, monkeypatch, via):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event
    owner, connection, _, _, space, root = setup
    second, _, _ = connect(owner)
    task = service.task_action(connection, 'create', space, root, objective='Pause race')
    before = {n['id'] for n in service.get_board(connection, space, root)['elements']}
    entered, release, pause_started = Event(), Event(), Event()
    original = service.ops.apply

    def slow_apply(*args, **kwargs):
        entered.set()
        assert release.wait(5), 'test did not release the in-flight write'
        return original(*args, **kwargs)

    def pause():
        pause_started.set()
        if via == 'browser':
            response = owner.post('/api/mcp/tasks/' + task['id'], headers=H, json={'state': 'paused', 'expected_revision': 0})
            assert response.status_code == 200
            return response.json()
        return service.task_action(second, 'paused', task_id=task['id'])

    monkeypatch.setattr(service.ops, 'apply', slow_apply)
    with ThreadPoolExecutor(max_workers=2) as pool:
        writing = pool.submit(service.apply_batch, connection, batch(space, root, task_id=task['id']))
        try:
            assert entered.wait(5)
            pausing = pool.submit(pause)
            assert pause_started.wait(5)
        finally:
            release.set()
        committed = writing.result(timeout=5)
        assert committed['revision'] == 1
        assert pausing.result(timeout=5)['state'] == 'paused'
    with pytest.raises(HTTPException, match='paused'):
        service.apply_batch(second, batch(space, root, expected_revision=1))
    assert {n['id'] for n in service.get_board(second, space, root)['elements']} == before | {committed['ids']['note']}


def test_note_body_limits_are_consistent_and_never_silently_truncated(setup):
    _, connection, _, _, space, root = setup
    text = 'source explanation ' * 2100
    value = batch(space, root)
    value['operations'][0]['node']['content']['body'] = text
    made = service.apply_batch(connection, value)
    changed = service.apply_batch(connection, batch(space, root, expected_revision=1,
        operations=[{'type': 'update', 'id': made['ids']['note'], 'patch': {'content': {'body': text + ' More context.'}}}]))
    assert changed['revision'] == 2
    too_long = batch(space, root, expected_revision=2)
    too_long['operations'][0]['node']['content']['body'] = 'x' * 100001
    with pytest.raises(HTTPException, match='100000'):
        service.apply_batch(connection, too_long)
    assert service.get_board(connection, space, root)['revision'] == 2


@pytest.mark.parametrize('kind', ['authorization_code', 'refresh_token'])
def test_concurrent_oauth_consumption_is_single_use(setup, kind):
    from concurrent.futures import ThreadPoolExecutor
    owner, *_ = setup
    _, tokens, form = connect(owner, redeem=kind != 'authorization_code')
    if kind == 'refresh_token':
        form = {'grant_type': kind, 'client_id': form['client_id'], 'refresh_token': tokens['refresh_token'], 'resource': RESOURCE}
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: owner.post('/api/mcp/oauth/token', data=form).status_code, range(2)))
    assert sorted(results) == [200, 400]


def test_concurrent_consent_is_single_use(setup):
    from concurrent.futures import ThreadPoolExecutor
    owner, *_ = setup
    client = owner.post('/api/mcp/oauth/register', json={'redirect_uris': ['https://client.example/callback']}).json()['client_id']
    challenge = base64.urlsafe_b64encode(hashlib.sha256(b'c' * 64).digest()).rstrip(b'=').decode()
    redirect = owner.get('/api/mcp/oauth/authorize', params={'client_id': client, 'redirect_uri': 'https://client.example/callback', 'code_challenge': challenge, 'resource': RESOURCE}, follow_redirects=False)
    pending = parse_qs(urlsplit(redirect.headers['location']).query)['request'][0]
    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(lambda _: owner.post('/api/mcp/consent/' + pending, headers=H, json={'mode': 'all'}).status_code, range(2)))
    assert sorted(statuses) == [200, 400]


def test_workspace_and_subboard_scope_enforcement(setup):
    owner, connection, _, _, space, root = setup
    current = owner.get('/api/spaces').json()
    workspace = next(w['id'] for w in current['workspaces'] if w['personal'])
    second_workspace = owner.post('/api/workspaces', headers=H, json={'name': 'Separate'}).json()['id']
    second_space = owner.post('/api/spaces', headers=H, json={'title': 'Separate', 'workspaceId': second_workspace}).json()['id']
    second_root = owner.get(f'/api/spaces/{second_space}/scene').json()['rootBoardId']
    limited, _, _ = connect(owner, {'mode': 'workspaces', 'ids': [workspace], 'edit': True})
    with pytest.raises(HTTPException): service.get_board(limited, second_space, second_root)
    created = service.apply_batch(connection, batch(space, root, operations=[{'type': 'create', 'ref': 'child', 'node': {'type': 'board', 'parentId': root, 'content': {'title': 'Scoped child'}}}]))
    child_id = created['ids']['child']
    selected, _, _ = connect(owner, {'mode': 'boards', 'ids': [child_id], 'edit': True})
    assert [w['id'] for w in service.discover(selected, 'workspaces')['items']] == [workspace]
    assert service.get_board(selected, space, child_id)['board']['parentId'] is None
    assert service.get_element(selected, space, child_id)['element']['parentId'] is None
    with pytest.raises(HTTPException): service.get_board(selected, space, root)
    with pytest.raises(HTTPException): service.get_element(selected, space, root)
    assert service.apply_batch(selected, batch(space, child_id, expected_revision=1))['revision'] == 2


def test_destructive_approval_cannot_be_substituted_between_connections(setup):
    owner, first, _, _, space, root = setup
    made = service.apply_batch(first, batch(space, root))
    second, _, _ = connect(owner)
    request = batch(space, root, expected_revision=1, operations=[{'type': 'delete', 'id': made['ids']['note']}])
    approval = service.apply_batch(first, request)
    assert approval['error'] == 'approval_required'
    assert owner.post('/api/mcp/approvals/' + approval['approval_id'], headers=H).status_code == 200
    refused = service.apply_batch(second, request)
    assert refused['error'] == 'approval_required'
    assert refused['approval_id'] != approval['approval_id']
    assert service.get_element(second, space, made['ids']['note'])['element']['id'] == made['ids']['note']
    assert service.apply_batch(first, request)['revision'] == 2
    assert service.apply_batch(first, request)['revision'] == 2
    with pytest.raises(HTTPException) as unavailable:
        service.apply_batch(second, request)
    assert unavailable.value.status_code == 404


def test_long_note_inspection_and_geometry_only_edit(setup):
    owner, connection, _, _, space, root = setup
    body = 'Source material. ' * 2200
    made = owner.post(f'/api/spaces/{space}/ops', headers=H, json={'op': {
        'type': 'create', 'node': {'id': uuid4().hex, 'type': 'note', 'parentId': root,
                                  'content': {'title': 'Long source', 'body': body}}}})
    assert made.status_code == 200
    note = next(n for n in owner.get(f'/api/spaces/{space}/scene').json()['nodes'] if n['content'].get('title') == 'Long source')
    page = service.get_board(connection, space, root)['elements']
    assert next(n for n in page if n['id'] == note['id'])['content']['body_truncated']
    recovered, offset = '', 0
    while True:
        inspected = service.get_element(connection, space, note['id'], offset)
        recovered += inspected['element']['content']['body']
        if inspected['next_text_offset'] is None:
            break
        offset = inspected['next_text_offset']
    assert recovered == body
    changed = service.apply_batch(connection, batch(space, root, expected_revision=1,
        operations=[{'type': 'update', 'id': note['id'], 'patch': {'x': 123}}]))
    assert changed['revision'] == 2
    assert service.get_element(connection, space, note['id'])['element']['x'] == 123


def test_one_task_elevation_and_expiration(setup):
    owner, connection, _, _, space, root = setup
    made = service.apply_batch(connection, batch(space, root))
    task = service.task_action(connection, 'create', space, root, objective='Elevated cleanup')
    grant = {'mode': 'all', 'edit': True, 'destructive': 'elevated', 'elevation': 'task', 'task_id': task['id']}
    assert owner.put('/api/mcp/connections/' + connection, headers=H, json=grant).status_code == 200
    remove = batch(space, root, expected_revision=1, operations=[{'type': 'delete', 'id': made['ids']['note']}])
    assert service.apply_batch(connection, remove)['error'] == 'approval_required'
    remove['task_id'] = task['id']
    assert service.apply_batch(connection, remove)['revision'] == 2
    more = service.apply_batch(connection, batch(space, root, expected_revision=2, task_id=task['id']))
    with SessionLocal() as db:
        row = db.get(McpConnection, connection)
        row.grants = {**row.grants, 'elevation': 'time', 'until': clock() - 1}
        db.commit()
    expired = batch(space, root, expected_revision=3, operations=[{'type': 'delete', 'id': more['ids']['note']}])
    assert service.apply_batch(connection, expired)['error'] == 'approval_required'


def test_mcp_changes_reach_existing_websocket(setup):
    owner, connection, _, _, space, root = setup
    with owner.websocket_connect(f'/api/spaces/{space}/live') as socket:
        assert socket.receive_json()['t'] == 'hello'
        made = service.apply_batch(connection, batch(space, root))
        event = socket.receive_json()
        assert event['t'] == 'op' and event['seq'] == made['revision']
        assert event['changes'][0]['node']['id'] == made['ids']['note']


def test_elevation_expiry_revocation_and_recovery(setup):
    owner, connection, _, _, space, root = setup
    made = service.apply_batch(connection, batch(space, root))
    body = {'mode': 'all', 'edit': True, 'destructive': 'elevated', 'elevation': 'time', 'until': clock() + 60}
    assert owner.put('/api/mcp/connections/' + connection, headers=H, json=body).status_code == 200
    remove = batch(space, root, expected_revision=1, operations=[{'type': 'delete', 'id': made['ids']['note']}])
    assert service.apply_batch(connection, remove)['revision'] == 2
    snapshot = owner.get('/api/mcp/snapshots').json()['snapshots'][0]['id']
    assert owner.post('/api/mcp/snapshots/' + snapshot + '/restore', headers=H, json={'expected_revision': 2, 'confirm': 'wrong'}).status_code == 400
    assert owner.post('/api/mcp/snapshots/' + snapshot + '/restore', headers=H, json={'expected_revision': 2, 'confirm': 'RESTORE SNAPSHOT'}).status_code == 200
    assert any(n['id'] == made['ids']['note'] for n in owner.get(f'/api/spaces/{space}/scene').json()['nodes'])
    owner.delete('/api/mcp/connections/' + connection, headers=H)
    with pytest.raises(HTTPException): service.get_board(connection, space, root)


def test_provider_transfer_ssrf_and_retry(setup, monkeypatch):
    import socket
    from app.mcp_download import destination, ProviderFile
    from app import mcp_download
    monkeypatch.setenv('MCP_SOURCE_HOSTS', 'files.provider.example')
    for address in ['127.0.0.1', '169.254.169.254', '10.0.0.1', '::1']:
        monkeypatch.setattr(socket, 'getaddrinfo', lambda *a, **k: [(2, 1, 6, '', (address, 443))])
        with pytest.raises(HTTPException): destination('https://files.provider.example/source')
    with pytest.raises(HTTPException): destination('https://untrusted.example/source')
    with pytest.raises(HTTPException): destination('https://files.provider.example:8443/source')
    owner, connection, _, _, space, root = setup
    image = io.BytesIO(); Image.new('RGB', (80, 40), 'orange').save(image, 'PNG')
    monkeypatch.setattr(mcp_download, 'download', lambda value: image.getvalue())
    source = ProviderFile(download_url='https://files.provider.example/source?private=token', file_id='provider-file-id', file_name='diagram.png')
    args = (connection, space, root, source, 'source-key', 0, 0, 0, 240, 160)
    first = service.import_source(*args)
    monkeypatch.setattr(mcp_download, 'download', lambda value: (_ for _ in ()).throw(AssertionError('Cached retry must not fetch expired URLs')))
    assert service.import_source(*args) == first
    with SessionLocal() as db:
        from app.mcp_models import McpBatch
        record = db.scalar(select(McpBatch).where(McpBatch.connection_id == connection, McpBatch.key == 'source-key'))
        assert 'private=token' not in json.dumps(record.result)


def test_provider_transfer_stops_slow_drip_response(monkeypatch):
    from urllib.parse import urlsplit
    from app import mcp_download
    elapsed, closed = [0], []

    class Response:
        status = 200
        def getheader(self, name): return None
        def read(self, size):
            elapsed[0] += 33
            return b'xxx'
        def read1(self, size):
            elapsed[0] += 11
            return b'x'

    class Connection:
        sock = None
        def __init__(self, *args, **kwargs): pass
        def request(self, *args, **kwargs): pass
        def getresponse(self): return Response()
        def close(self): closed.append(True)

    monkeypatch.setattr(mcp_download, 'destination', lambda _: (urlsplit('https://files.example/source'), '8.8.8.8'))
    monkeypatch.setattr(mcp_download, 'monotonic', lambda: elapsed[0], raising=False)
    monkeypatch.setattr(mcp_download.http.client, 'HTTPSConnection', Connection)
    with pytest.raises(HTTPException, match='transfer failed'):
        mcp_download.download('https://files.example/source')
    assert closed == [True]
