"""Real HTTP/SDK contract exercise. Only run on a disposable local development instance."""
import argparse
import base64
import hashlib
import json
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import anyio
import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client


async def run(base):
    url = urlsplit(base)
    if url.scheme != "http" or url.hostname not in {"127.0.0.1", "localhost", "::1"} or not url.port or url.username or url.password:
        raise SystemExit("Only explicit HTTP loopback origins are allowed")
    headers = {"X-Zoomz": "1"}
    async with httpx.AsyncClient(base_url=base, headers=headers, follow_redirects=False, trust_env=False, timeout=30) as web:
        assert (await web.get('/api/auth/config')).json()['dev'] is True, 'Development mode required'
        login = await web.post('/api/auth/magic-link', json={'email': f'mcp-smoke-{uuid4().hex}@example.com'})
        assert 'devLink' in login.json(), 'Use a disposable local instance without SMTP'
        assert (await web.get(login.json()['devLink'])).status_code == 303
        available = (await web.get('/api/spaces')).json()
        workspace = next(w['id'] for w in available['workspaces'] if w['personal'])
        resource = (await web.get('/.well-known/oauth-protected-resource/mcp')).json()['resource']
        registered = (await web.post('/api/mcp/oauth/register', json={'client_name': 'Local SDK smoke', 'redirect_uris': ['https://client.example/callback']})).json()
        verifier = 's' * 64
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode()
        authorization = await web.get('/api/mcp/oauth/authorize', params={'client_id': registered['client_id'], 'redirect_uri': 'https://client.example/callback',
            'code_challenge': challenge, 'resource': resource, 'scope': 'zoomz:read zoomz:edit offline_access', 'state': 'smoke-state'})
        pending = parse_qs(urlsplit(authorization.headers['location']).query)['request'][0]
        consent = await web.post('/api/mcp/consent/' + pending, json={'mode': 'workspaces', 'ids': [workspace], 'edit': True})
        code = parse_qs(urlsplit(consent.json()['redirect']).query)['code'][0]
        exchanged = await web.post('/api/mcp/oauth/token', data={'grant_type': 'authorization_code', 'client_id': registered['client_id'], 'code': code,
            'code_verifier': verifier, 'redirect_uri': 'https://client.example/callback', 'resource': resource})
        exchanged.raise_for_status()
        token = exchanged.json()['access_token']
        async with httpx.AsyncClient(headers={'Authorization': 'Bearer ' + token}, trust_env=False, timeout=30) as transport:
            async with streamable_http_client(base + '/mcp', http_client=transport) as (read, write, _):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    async def tool(name, arguments):
                        result = await session.call_tool(name, arguments)
                        assert not result.isError, name
                        assert result.structuredContent is not None, name
                        return result.structuredContent
                    made = await tool('create_moodboard', {'workspace_id': workspace, 'title': 'MCP synthetic revision test', 'idempotency_key': 'root'})
                    sid, root = made['space_id'], made['board_id']
                    task = await tool('generation_task', {'action': 'create', 'space_id': sid, 'board_id': root, 'objective': 'Curate graphs and sorting into revision topics; preserve citations'})
                    upload = await tool('upload_media', {'space_id': sid, 'board_id': root, 'filename': 'lecture-graphs.txt',
                        'data_base64': base64.b64encode(b'Lecture 1: Graphs\nBFS uses a queue. Adjacency lists cost O(V+E).\nTable: list O(V+E), matrix O(V^2).\nDiagram: A--B--C').decode(),
                        'idempotency_key': 'source', 'expected_revision': 0, 'x': 900, 'y': 40, 'w': 280, 'h': 240, 'task_id': task['id']})
                    value = {'space_id': sid, 'expected_revision': upload['revision'], 'idempotency_key': 'topics', 'task_id': task['id'], 'operations': [
                        {'type': 'create', 'ref': 'graphs', 'node': {'type': 'board', 'parentId': root, 'x': 40, 'y': 40, 'w': 360, 'h': 330, 'content': {'title': 'Graphs'}}},
                        {'type': 'create', 'ref': 'traversal', 'node': {'type': 'board', 'parentId': '$graphs', 'x': 40, 'y': 40, 'w': 360, 'h': 330, 'content': {'title': 'Traversal'}}},
                        {'type': 'create', 'ref': 'sorting', 'node': {'type': 'board', 'parentId': root, 'x': 460, 'y': 40, 'w': 360, 'h': 330, 'content': {'title': 'Sorting'}}},
                        {'type': 'create', 'ref': 'summary', 'node': {'type': 'note', 'parentId': '$traversal', 'x': 40, 'y': 40, 'w': 400, 'h': 300, 'content': {'title': 'BFS', 'body': 'A queue visits vertices by distance. Adjacency lists use O(V+E) space.', 'references': [{'asset_id': upload['file_id'], 'classification': 'source', 'section': 'Graph representations', 'availability': 'available'}]}}},
                        {'type': 'create', 'ref': 'example', 'node': {'type': 'note', 'parentId': '$sorting', 'x': 40, 'y': 40, 'w': 400, 'h': 300, 'content': {'title': 'Supplementary example', 'body': 'Trace insertion sort on [3, 1, 2]. This example is supplementary, not a lecture quotation.', 'references': [{'classification': 'supplementary', 'availability': 'unverified'}]}}},
                    ]}
                    batch = await tool('apply_canvas_batch', {'batch': value})
                    assert await tool('apply_canvas_batch', {'batch': value}) == batch
                    paused = await web.post('/api/mcp/tasks/' + task['id'], json={'state': 'paused', 'expected_revision': batch['revision']})
                    assert paused.status_code == 200
                    manual = await web.post(f'/api/spaces/{sid}/ops', json={'op': {'type': 'create', 'node': {'id': 'manual-' + uuid4().hex, 'type': 'note', 'parentId': root, 'content': {'title': 'Manual reminder', 'body': 'Keep this edit'}}}})
                    assert manual.status_code == 200
                    revision = manual.json()['seq']
                    await tool('generation_task', {'action': 'generating', 'task_id': task['id'], 'expected_revision': revision})
                    inspected = await tool('get_board', {'space_id': sid, 'board_id': batch['ids']['traversal']})
                    assert inspected['elements'][0]['x'] == 40
                    await tool('generation_task', {'action': 'checkpoint', 'task_id': task['id'], 'expected_revision': revision, 'checkpoint': {'summary': 'Graph hierarchy complete', 'outstanding_work': 'Upload sorting lecture for source-derived notes', 'missing_sources': ['Sorting lecture']}})
                    await tool('generation_task', {'action': 'completed', 'task_id': task['id'], 'expected_revision': revision})
                    final = (await web.get(f'/api/spaces/{sid}/scene')).json()
                    assert any(n['content'].get('body') == 'Keep this edit' for n in final['nodes'])
                    assert len(final['nodes']) == 8
                    print('PASS real HTTP OAuth + SDK initialization, nested edits, sources, retries, browser-API pause, manual edits, resume, checkpoint, finalization')
                    print('Synthetic contract fixture only. No real ChatGPT/Claude account or visual/educational-quality verification.')
                    print('Test moodboard path: /b/' + sid)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', required=True)
    anyio.run(run, parser.parse_args().url.rstrip('/'))
