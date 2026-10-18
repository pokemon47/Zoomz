"""Seed, restart the disposable database/application, then verify persisted MCP state.

Requires an already migrated disposable loopback PostgreSQL database and private
temporary media storage. Never run against real account data.
"""
import argparse
import base64
import io
import json
import os
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

import anyio
from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image


def run(phase, state_path):
    database = urlsplit(os.environ.get('DATABASE_URL', '').replace('postgresql+psycopg:', 'postgresql:'))
    storage = Path(os.environ.get('STORAGE_DIR', '')).resolve()
    assert os.environ.get('ZOOMZ_RESTART_TEST') == '1', 'Explicit disposable restart-test opt-in required'
    assert database.scheme == 'postgresql' and database.hostname in {'127.0.0.1', 'localhost', '::1'}
    assert database.path.startswith('/zoomz_mcp_test'), 'Use a dedicated zoomz_mcp_test database'
    assert storage.is_relative_to('/tmp') and state_path.resolve().is_relative_to('/tmp'), 'Private temporary artifacts required'
    assert os.environ.get('APP_ENV') == 'development' and os.environ.get('PUBLIC_URL') == 'http://testserver'
    assert not os.environ.get('SMTP_HOST'), 'Development links must stay local'

    from app.main import app
    from app import mcp_service as service
    from app.mcp_server import Verifier
    from tests.test_mcp import connect, H

    with TestClient(app) as owner:
        state = json.loads(state_path.read_text()) if phase == 'verify' else {'email': f'mcp-restart-{uuid4().hex}@example.com'}
        login = owner.post('/api/auth/magic-link', headers=H, json={'email': state['email']})
        assert login.status_code == 200
        assert owner.get(login.json()['devLink'], follow_redirects=False).status_code == 303
        if phase == 'seed':
            connection, tokens, _ = connect(owner)
            workspace = owner.get('/api/spaces').json()['workspaces'][0]['id']
            made = service.create_moodboard(connection, workspace, 'Restart acceptance', 'restart-root')
            space, root = made['space_id'], made['board_id']
            task = service.task_action(connection, 'create', space, root, objective='Continue after restart')
            image = io.BytesIO()
            Image.new('RGB', (80, 40), 'orange').save(image, 'PNG')
            media = service.upload_media(connection, space, root, 'diagram.png', base64.b64encode(image.getvalue()).decode(),
                                         'restart-image', 0, 20, 20, 240, 160, task_id=task['id'])
            batch = {'space_id': space, 'expected_revision': media['revision'], 'idempotency_key': 'restart-note', 'task_id': task['id'],
                     'operations': [{'type': 'create', 'ref': 'note', 'node': {'type': 'note', 'parentId': root,
                         'content': {'title': 'Persisted source note', 'body': 'Keep the checkpoint',
                                     'references': [{'asset_id': media['file_id'], 'classification': 'source', 'availability': 'available'}]}}}]}
            result = service.apply_batch(connection, batch)
            service.task_action(connection, 'checkpoint', task_id=task['id'], expected_revision=result['revision'],
                                checkpoint={'summary': 'Sources and note saved', 'outstanding_work': 'Finish after restart'})
            service.task_action(connection, 'paused', task_id=task['id'])
            manual = owner.post(f'/api/spaces/{space}/ops', headers=H, json={'op': {'type': 'create', 'node': {
                'id': 'manual-' + uuid4().hex, 'type': 'note', 'parentId': root, 'content': {'title': 'Manual edit while paused'}}}})
            assert manual.status_code == 200
            state.update(connection=connection, token=tokens['access_token'], task=task['id'], space=space, root=root,
                         media=media['file_id'], batch=batch, result=result, revision=manual.json()['seq'])
            with open(state_path, 'x', opener=lambda path, flags: os.open(path, flags, 0o600)) as output:
                json.dump(state, output)
            print('PASS seeded paused task, checkpoint, source media, retry ledger, OAuth credential and manual edit')
            return

        async def verify_token():
            return await Verifier().verify_token(state['token'])
        assert anyio.run(verify_token) is not None, 'Existing OAuth credential must survive restart'
        connection = state['connection']
        task = next(t for t in service.task_action(connection, 'list')['tasks'] if t['id'] == state['task'])
        assert task['state'] == 'paused' and task['checkpoint']['summary'] == 'Sources and note saved'
        try:
            service.apply_batch(connection, {**state['batch'], 'expected_revision': state['revision'], 'idempotency_key': 'blocked-after-restart'})
        except HTTPException as error:
            assert error.status_code == 409 and 'paused' in error.detail
        else:
            raise AssertionError('Persisted pause must reject writes')
        service.task_action(connection, 'generating', task_id=state['task'], expected_revision=state['revision'])
        assert service.apply_batch(connection, state['batch']) == state['result'], 'Retry must return existing IDs'
        scene = service.get_board(connection, state['space'], state['root'])
        assert scene['revision'] == state['revision']
        assert sum(n['content'].get('title') == 'Persisted source note' for n in scene['elements']) == 1
        assert any(n['content'].get('title') == 'Manual edit while paused' for n in scene['elements'])
        visual = service.get_source_visual(connection, state['space'], state['media'])
        with Image.open(io.BytesIO(visual['image'])) as image:
            assert image.size == (80, 40)
        successor, _, _ = connect(owner)
        assert any(t['id'] == state['task'] for t in service.task_action(successor, 'list')['tasks'])
        service.task_action(successor, 'completed', task_id=state['task'], expected_revision=state['revision'])
        print('PASS fresh application process after database restart: OAuth, pause enforcement, checkpoint, safe retry, manual edit, media and new-connection finalization')
        print('Local PostgreSQL/ASGI verification only; not a production container or real AI client')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=['seed', 'verify'])
    parser.add_argument('--state', required=True, type=Path)
    arguments = parser.parse_args()
    run(arguments.phase, arguments.state)
