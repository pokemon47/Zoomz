import base64
import io
import os

from fastapi import HTTPException
from PIL import Image
import pytest

from app import mcp_preview as preview
from app import mcp_service as service
from app.db import SessionLocal
from app.mcp_models import McpConnection
from app.models import Node
from tests.test_mcp import setup, connect, batch, H  # noqa: F401


def test_preview_subtree_geometry_and_scope(setup, make_client):
    owner, connection, _, _, space, root = setup
    made = service.apply_batch(connection, batch(space, root, operations=[
        {'type': 'create', 'ref': 'topic', 'node': {'type': 'board', 'parentId': root, 'x': 23, 'y': 44, 'w': 430, 'h': 340, 'content': {'title': 'Graphs'}}},
        {'type': 'create', 'ref': 'nested', 'node': {'type': 'board', 'parentId': '$topic', 'x': 200, 'y': 100, 'content': {'title': 'Traversal'}}},
        {'type': 'create', 'ref': 'note', 'node': {'type': 'note', 'parentId': '$nested', 'x': 17, 'y': 31, 'content': {'body': 'BFS uses a queue'}}},
    ]))
    selected, _, _ = connect(owner, {'mode': 'boards', 'ids': [made['ids']['topic']], 'edit': False})
    scene = preview.preview_scene(selected, space, made['ids']['topic'])
    assert {n['id'] for n in scene.snapshot['nodes']} == set(made['ids'].values())
    assert scene.snapshot['nodes'][0]['parentId'] is None
    note = next(n for n in scene.snapshot['nodes'] if n['id'] == made['ids']['note'])
    assert (note['x'], note['y']) == (17, 31)
    assert scene.snapshot['space']['role'] == 'viewer'
    with pytest.raises(HTTPException): preview.preview_scene(selected, space, root)
    other = make_client('preview-other@example.com')
    outsider, _, _ = connect(other)
    with pytest.raises(HTTPException): preview.preview_scene(outsider, space, root)
    assert owner.delete('/api/mcp/connections/' + selected, headers=H).status_code == 200
    with pytest.raises(HTTPException): preview.preview_scene(selected, space, made['ids']['topic'])


def test_preview_limits_disabled_and_busy(setup, monkeypatch):
    _, connection, _, _, space, root = setup
    monkeypatch.delenv('MCP_RENDER_PREVIEWS', raising=False)
    with pytest.raises(HTTPException) as disabled:
        preview.get_board_preview(connection, space, root)
    assert disabled.value.status_code == 503
    monkeypatch.setenv('MCP_RENDER_PREVIEWS', 'true')
    monkeypatch.setenv('MCP_RENDER_ORIGIN', 'http://127.0.0.1:5178')
    with pytest.raises(HTTPException) as dimensions:
        preview.get_board_preview(connection, space, root, 10000, 500)
    assert dimensions.value.status_code == 400
    preview._render_slot.acquire()
    try:
        with pytest.raises(HTTPException) as busy:
            preview.get_board_preview(connection, space, root)
        assert busy.value.status_code == 429
    finally:
        preview._render_slot.release()
    monkeypatch.setenv('MCP_RENDER_ORIGIN', 'http://169.254.169.254')
    with pytest.raises(HTTPException): preview.render_origin()


def test_preview_has_only_authorized_assets(setup):
    _, connection, _, _, space, root = setup
    image = io.BytesIO()
    Image.new('RGB', (40, 20), 'orange').save(image, 'PNG')
    stored = service.upload_media(connection, space, root, 'image.png', base64.b64encode(image.getvalue()).decode(), 'preview-file', 0, 0, 0, 300, 200)
    scene = preview.preview_scene(connection, space, root)
    assert f"/api/files/{stored['file_id']}/thumb_256" in scene.assets


def test_preview_revocation_during_render_discards_image(setup, monkeypatch):
    _, connection, _, _, space, root = setup
    monkeypatch.setenv('MCP_RENDER_PREVIEWS', '1')
    monkeypatch.setenv('MCP_RENDER_ORIGIN', 'http://127.0.0.1:5178')
    async def revoke_during_capture(*args):
        with SessionLocal() as db:
            db.get(McpConnection, connection).revoked = True
            db.commit()
        return {'image': b'private-image', 'metadata': {}}
    monkeypatch.setattr(preview, 'capture', revoke_during_capture)
    with pytest.raises(HTTPException) as revoked:
        preview.get_board_preview(connection, space, root)
    assert revoked.value.status_code == 401


def test_preview_rejects_oversized_hierarchy(setup):
    _, connection, _, _, space, root = setup
    with SessionLocal() as db:
        db.add_all(Node(id=f'preview-limit-{i}', space_id=space, parent_id=root, type='note', content={'body': 'bounded'}) for i in range(2001))
        db.commit()
    with pytest.raises(HTTPException) as oversized:
        preview.preview_scene(connection, space, root)
    assert oversized.value.status_code == 413


@pytest.mark.skipif(os.environ.get('ZOOMZ_BROWSER_TESTS') != '1', reason='Requires built frontend and sandboxed Chromium; see docs/mcp/SETUP.md')
def test_real_renderer_nested_and_close_views(setup, monkeypatch, tmp_path):
    owner, connection, tokens, *_ = setup
    workspace = owner.get('/api/spaces').json()['workspaces'][0]['id']
    made = service.create_moodboard(connection, workspace, 'Renderer acceptance', 'render-root')
    space, root = made['space_id'], made['board_id']
    created = service.apply_batch(connection, batch(space, root, operations=[
        {'type': 'create', 'ref': 'topic', 'node': {'type': 'board', 'parentId': root, 'x': 40, 'y': 40, 'w': 520, 'h': 440, 'content': {'title': 'Graph theory'}}},
        {'type': 'create', 'ref': 'nested', 'node': {'type': 'board', 'parentId': '$topic', 'x': 500, 'y': 100, 'w': 400, 'h': 330, 'content': {'title': 'Traversal'}}},
        {'type': 'create', 'ref': 'note', 'node': {'type': 'note', 'parentId': '$topic', 'x': 30, 'y': 40, 'w': 350, 'h': 280, 'content': {'title': 'Breadth-first search', 'body': 'A queue visits vertices by distance. Adjacency lists use O(V + E) space.'}}},
        {'type': 'create', 'ref': 'deep', 'node': {'type': 'note', 'parentId': '$nested', 'x': 30, 'y': 40, 'w': 350, 'h': 280, 'content': {'title': 'DFS', 'body': 'Depth-first search follows a branch before returning.'}}},
    ]))
    image = io.BytesIO()
    Image.new('RGB', (200, 120), 'coral').save(image, 'PNG')
    service.upload_media(connection, space, created['ids']['topic'], 'diagram.png', base64.b64encode(image.getvalue()).decode(), 'render-image', 1, 30, 400, 350, 210)
    monkeypatch.setenv('MCP_RENDER_PREVIEWS', 'true')
    results = []
    for name, board, bounds in [('root', root, None), ('topic', created['ids']['topic'], None),
            ('close', created['ids']['topic'], {'x': 0, 'y': 0, 'w': 430, 'h': 340})]:
        result = preview.get_board_preview(connection, space, board, 1000, 720, bounds)
        assert result['metadata']['revision'] == 2
        assert result['metadata']['renderer'] == 'Zoomz SpaceCanvas'
        with Image.open(io.BytesIO(result['image'])) as rendered:
            assert rendered.size == (1000, 720)
            assert rendered.getextrema() != ((255, 255),) * 3
        artifact = tmp_path / (name + '.jpg')
        artifact.write_bytes(result['image'])
        print('Preview artifact:', artifact)
        results.append(result['image'])
    assert len(set(results)) == 3
    import anyio
    import httpx
    from app.main import app
    from mcp import ClientSession
    from mcp.client.streamable_http import streamable_http_client
    async def protocol_preview():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), headers={'Authorization': 'Bearer ' + tokens['access_token']}) as http:
            async with streamable_http_client('http://testserver/mcp', http_client=http) as (read, write, _):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    result = await session.call_tool('get_board_preview', {'space_id': space, 'board_id': created['ids']['nested']})
                    assert not result.isError, result.content
                    assert result.structuredContent['board_id'] == created['ids']['nested']
                    assert any(block.type == 'image' and block.mimeType == 'image/jpeg' for block in result.content)
    anyio.run(protocol_preview)
