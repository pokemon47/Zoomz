"""Disposable CI container checks. Never run against a real instance."""

import os
import sys
import urllib.request
from pathlib import Path

assert os.environ.get("ZOOMZ_CONTAINER_TEST") == "1", "Only run in a disposable CI project"

from sqlalchemy import select
from websockets.sync.client import connect

from app.auth import get_or_create_user
from app.db import SessionLocal
from app.models import Node, Space, StoredFile, new_id
from app.ops import file_urls
from app.storage import path_for


def mcp_check(mode, user=None, space=None):
    import anyio
    import httpx
    from mcp import ClientSession
    from mcp.client.streamable_http import streamable_http_client
    from urllib.parse import urlsplit
    from app.config import settings
    from app.mcp_access import clock, resource_url
    from app.mcp_models import McpClient, McpConnection, McpCredential
    from app.mcp_service import apply_batch, task_action
    from app.security import hash_token

    # Synthetic credentials only exist in the explicitly guarded disposable CI database.
    cid, client_id = 'c' * 32, 'd' * 32
    raw = 'ci-only-mcp-credential-not-for-production'

    def batch_for(task):
        return {'space_id': task['space_id'], 'expected_revision': 0, 'idempotency_key': 'ci-persisted-batch', 'task_id': task['id'],
            'operations': [{'type': 'create', 'ref': 'note', 'node': {'type': 'note', 'parentId': task['board_id'], 'content': {'title': 'MCP CI persistence', 'body': 'Retain checkpoint and retry across restart and recovery.'}}}]}

    if mode == 'seed':
        with SessionLocal() as db:
            db.add(McpClient(id=client_id, name='CI SDK', redirects=['https://client.example/callback']))
            db.flush()
            db.add(McpConnection(id=cid, client_id=client_id, user_id=user.id,
                grants={'mode': 'workspaces', 'ids': [space.workspace_id], 'edit': True, 'destructive': 'block'}))
            db.flush()
            db.add(McpCredential(digest=hash_token(raw), connection_id=cid, kind='access', expires=clock()+86400, payload={'resource': resource_url()}))
            db.commit()
        task = task_action(cid, 'create', space.id, space.root_board_id, objective='CI persisted draft')
        apply_batch(cid, batch_for(task))
        task_action(cid, 'checkpoint', task_id=task['id'], expected_revision=1, checkpoint={'summary': 'Persisted CI checkpoint'})
        return

    async def verify():
        host = urlsplit(settings.public_url).netloc
        async with httpx.AsyncClient(headers={'Host': host}, trust_env=False, timeout=15) as web:
            metadata = await web.get('http://127.0.0.1:8080/.well-known/oauth-protected-resource/mcp')
            assert metadata.status_code == 200 and metadata.json()['resource'] == resource_url()
            unauthenticated = await web.post('http://127.0.0.1:8080/mcp', json={})
            assert unauthenticated.status_code == 401
        async with httpx.AsyncClient(headers={'Host': host, 'Authorization': 'Bearer ' + raw}, trust_env=False, timeout=15) as http:
            async with streamable_http_client('http://127.0.0.1:8080/mcp', http_client=http) as (read, write, _):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    result = await session.call_tool('generation_task', {'action': 'list'})
                    assert not result.isError and result.structuredContent
                    task = next(t for t in result.structuredContent['tasks'] if t['objective'] == 'CI persisted draft')
                    assert task['checkpoint']['summary'] == 'Persisted CI checkpoint'
                    retry = await session.call_tool('apply_canvas_batch', {'batch': batch_for(task)})
                    assert not retry.isError and retry.structuredContent['revision'] == 1
                    inspected = await session.call_tool('get_board', {'space_id': task['space_id'], 'board_id': task['board_id']})
                    assert any(n['content'].get('title') == 'MCP CI persistence' for n in inspected.structuredContent['elements'])
                    assert inspected.structuredContent['revision'] == 1
        print('MCP production proxy, SDK authentication, persisted task/checkpoint/content and idempotent retry passed')
    anyio.run(verify)


with SessionLocal() as db:
    if sys.argv[1] == "seed":
        from PIL import Image
        import pypdfium2

        # Check the PDF native runtime is loadable in the minimal Linux app image too.
        pdf = pypdfium2.PdfDocument.new()
        pdf.close()

        user, _ = get_or_create_user(db, "ci-probe@example.com")
        space = db.scalar(select(Space).where(Space.created_by == user.id))
        space.public_token = "ci-public-token"
        fid = new_id()
        file = path_for(f"{space.id}/{fid}/original")
        file.parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGB", (16, 16), (255, 142, 114)).save(file, format="PNG")
        import hashlib

        db.add(StoredFile(id=fid, space_id=space.id, uploader_id=user.id, filename="ci-probe.png", mime="image/png", kind="image", size=file.stat().st_size, sha256=hashlib.sha256(file.read_bytes()).hexdigest(), status="ready"))
        db.flush()
        db.add(Node(id="ci-persistent-image", space_id=space.id, parent_id=space.root_board_id, type="image", x=12, y=34, w=200, h=200, content={"title": "CI image", "alt": "CI", "fileId": fid}))
        db.commit()
    elif sys.argv[1] == "verify":
        import hashlib

        node = db.get(Node, "ci-persistent-image")
        assert node and node.x == 12 and node.y == 34
        file = db.get(StoredFile, node.content["fileId"])
        space = db.get(Space, node.space_id)
        payload = urllib.request.urlopen("http://127.0.0.1:8080" + file_urls(file)["src"], timeout=10).read()
        assert hashlib.sha256(payload).hexdigest() == file.sha256
        with connect(f"ws://127.0.0.1:8080/api/spaces/{space.id}/live?public={space.public_token}", open_timeout=10) as socket:
            import json

            assert json.loads(socket.recv())["role"] == "viewer"
            socket.send(json.dumps({"t": "op", "cid": "denied", "op": {"type": "delete", "id": node.id}}))
            assert json.loads(socket.recv())["t"] == "reject"
        print("Database/media persistence, protected media, WebSocket proxy, and viewer rejection passed")
    else:
        raise SystemExit("Expected seed or verify")

mcp_check(sys.argv[1], user if sys.argv[1] == 'seed' else None, space)
