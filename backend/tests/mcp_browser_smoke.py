"""UI acceptance on an explicitly selected disposable loopback development instance."""
import argparse
import base64
import hashlib
import re
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import anyio
import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from playwright.sync_api import sync_playwright, expect


def run(base):
    url = urlsplit(base)
    if url.scheme != 'http' or url.hostname not in {'127.0.0.1', 'localhost', '::1'} or not url.port or url.username or url.password:
        raise SystemExit('Explicit disposable HTTP loopback origin required')
    assert httpx.get(base + '/api/auth/config', trust_env=False).json()['dev'], 'Development instance required'
    with sync_playwright() as runtime:
        browser = runtime.chromium.launch(chromium_sandbox=True)
        try:
            context = browser.new_context(viewport={'width': 1440, 'height': 1000}, reduced_motion='reduce')
            page = context.new_page()
            page.set_default_timeout(10000)
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(base + '/login?next=/ai')
            page.get_by_label('Email', exact=True).fill('mcp-browser-' + uuid4().hex + '@example.com')
            page.get_by_role('button', name='Email me a sign-in link', exact=True).click()
            page.get_by_role('link', name='Open sign-in link (development)', exact=True).click()
            page.wait_for_url(base + '/ai')
            expect(page.get_by_label('Instance MCP endpoint')).to_have_value(base + '/mcp')
            request = context.request
            def api(path, value=None):
                response = request.get(base + path) if value is None else request.post(base + path, data=value, headers={'X-Zoomz': '1'})
                assert response.ok, f'{path}: {response.status}'
                return response.json()
            client = api('/api/mcp/oauth/register', {'client_name': 'Browser acceptance', 'redirect_uris': [base + '/client-callback']})
            verifier = 'b' * 64
            challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode()
            authorized = request.get(base + '/api/mcp/oauth/authorize', params={'client_id': client['client_id'], 'redirect_uri': base + '/client-callback',
                'code_challenge': challenge, 'resource': base + '/mcp', 'scope': 'zoomz:read zoomz:edit offline_access', 'state': 'browser-state'}, max_redirects=0)
            page.route(base + '/client-callback?*', lambda route: route.fulfill(content_type='text/html', body='OAuth callback received'))
            page.goto(authorized.headers['location'])
            page.locator('fieldset input[type=checkbox]').first.check()
            page.get_by_label('Allow creation and editing').check()
            page.get_by_role('button', name='Authorize this client', exact=True).click()
            page.wait_for_url(base + '/client-callback?*')
            callback = parse_qs(urlsplit(page.url).query)
            assert callback['state'] == ['browser-state']
            exchanged = request.post(base + '/api/mcp/oauth/token', form={'grant_type': 'authorization_code', 'client_id': client['client_id'],
                'code': callback['code'][0], 'code_verifier': verifier, 'redirect_uri': base + '/client-callback', 'resource': base + '/mcp'})
            assert exchanged.ok
            token = exchanged.json()['access_token']
            def tool(name, arguments):
                async def invoke():
                    async with httpx.AsyncClient(headers={'Authorization': 'Bearer ' + token}, trust_env=False, timeout=30) as http:
                        async with streamable_http_client(base + '/mcp', http_client=http) as (read, write, _):
                            async with ClientSession(read, write) as session:
                                await session.initialize()
                                result = await session.call_tool(name, arguments)
                                assert not result.isError, name
                                return result.structuredContent
                with ThreadPoolExecutor(max_workers=1) as worker:
                    return worker.submit(anyio.run, invoke).result(timeout=35)
            workspace = api('/api/spaces')['workspaces'][0]['id']
            made = tool('create_moodboard', {'workspace_id': workspace, 'title': 'Browser acceptance', 'idempotency_key': 'browser-root'})
            space, root = made['space_id'], made['board_id']
            page.goto(base + '/b/' + space)
            expect(page.locator('.zb-viewport')).to_be_visible()
            task = tool('generation_task', {'action': 'create', 'space_id': space, 'board_id': root, 'objective': 'Browser draft acceptance'})
            created = tool('apply_canvas_batch', {'batch': {'space_id': space, 'expected_revision': 0, 'idempotency_key': 'browser-content', 'task_id': task['id'], 'operations': [
                {'type': 'create', 'ref': 'note', 'node': {'type': 'note', 'parentId': root, 'x': 30, 'y': 40, 'w': 380, 'h': 280, 'content': {'title': 'Source note', 'body': 'BFS uses a queue', 'references': [{'title': 'Lecture 1', 'classification': 'source', 'availability': 'missing'}]}}},
                {'type': 'create', 'ref': 'topic', 'node': {'type': 'board', 'parentId': root, 'x': 500, 'y': 40, 'w': 450, 'h': 350, 'content': {'title': 'Topic'}}},
                {'type': 'create', 'ref': 'nested', 'node': {'type': 'board', 'parentId': '$topic', 'x': 40, 'y': 40, 'w': 400, 'h': 330, 'content': {'title': 'Nested topic'}}},
            ]}})
            note = page.locator(f'[data-item="{created["ids"]["note"]}"]')
            expect(note).to_be_visible()
            note.click()
            page.get_by_role('button', name='Sources · 1', exact=True).click()
            expect(page.get_by_role('dialog')).to_contain_text('Lecture 1')
            page.keyboard.press('Escape')
            expect(page.get_by_role('dialog')).to_have_count(0)
            draft = page.locator('details').filter(has=page.locator('summary', has_text='Browser draft acceptance'))
            draft.locator('summary').click()
            draft.get_by_role('button', name='Pause', exact=True).click()
            expect(draft.locator('summary')).to_contain_text('paused')
            draft.locator('summary').click()
            page.get_by_role('button', name='Add', exact=True).click()
            page.get_by_role('menuitem', name='Note', exact=True).click()
            dialog = page.get_by_role('dialog')
            dialog.get_by_label('Title', exact=True).fill('Manual edit while paused')
            dialog.get_by_label('Note', exact=True).fill('Keep this manual content')
            dialog.get_by_role('button', name='Add note', exact=True).click()
            expect(page.get_by_role('group', name=re.compile('Note: Manual edit while paused'))).to_be_visible()
            page.keyboard.press('ControlOrMeta+z')
            expect(page.get_by_role('group', name=re.compile('Note: Manual edit while paused'))).to_have_count(0)
            page.keyboard.press('ControlOrMeta+Shift+z')
            expect(page.get_by_role('group', name=re.compile('Note: Manual edit while paused'))).to_be_visible()
            draft.locator('summary').click()
            draft.get_by_role('button', name='Resume writes', exact=True).click()
            expect(draft.locator('summary')).to_contain_text('generating')
            # The existing input is the supported authenticated multi-file fallback.
            page.locator('input[type=file]').set_input_files([
                {'name': 'lecture-a.txt', 'mimeType': 'text/plain', 'buffer': b'Graph theory source'},
                {'name': 'lecture-b.txt', 'mimeType': 'text/plain', 'buffer': b'Sorting source'},
            ])
            expect(page.get_by_role('group', name='File: lecture-a.txt', exact=True)).to_be_visible()
            expect(page.get_by_role('group', name='File: lecture-b.txt', exact=True)).to_be_visible()
            page.wait_for_function("async path => { const s = await fetch(path).then(r => r.json()); return ['lecture-a.txt', 'lecture-b.txt'].every(name => s.nodes.some(n => n.content.title === name && n.content.fileId)); }", arg=f'/api/spaces/{space}/scene')
            page.goto(base + '/ai')
            page.get_by_label('Allow creation and editing').uncheck()
            page.get_by_role('button', name='Save permissions', exact=True).click()
            expect(page.get_by_role('button', name='Save permissions', exact=True)).to_be_enabled()
            assert tool('create_moodboard', {'workspace_id': workspace, 'title': 'Denied', 'idempotency_key': 'read-only-denied'})['status'] == 403
            page.get_by_label('Allow creation and editing').check()
            page.get_by_role('button', name='Save permissions', exact=True).click()
            expect(page.get_by_role('button', name='Save permissions', exact=True)).to_be_enabled()
            scene = api(f'/api/spaces/{space}/scene')
            removal = {'space_id': space, 'expected_revision': scene['seq'], 'idempotency_key': 'approved-remove', 'operations': [{'type': 'delete', 'id': created['ids']['note']}]}
            approval = tool('apply_canvas_batch', {'batch': removal})
            assert approval['error'] == 'approval_required'
            page.get_by_role('button', name='Refresh', exact=True).click()
            page.get_by_role('button', name='Approve these exact operations', exact=True).click()
            expect(page.get_by_role('button', name='Approved; assistant may retry', exact=True)).to_be_visible()
            assert 'revision' in tool('apply_canvas_batch', {'batch': removal})
            page.goto(base + '/b/' + space)
            expect(page.get_by_role('group', name=re.compile('Note: Manual edit while paused'))).to_be_visible()
            expect(page.locator(f'[data-item="{created["ids"]["note"]}"]')).to_have_count(0)
            current = api(f'/api/spaces/{space}/scene')
            tool('generation_task', {'action': 'completed', 'task_id': task['id'], 'expected_revision': current['seq']})
            page.goto(base + '/ai')
            page.get_by_role('button', name='Revoke connection', exact=True).click()
            expect(page.get_by_role('heading', name='Browser acceptance · Revoked')).to_be_visible()
            assert httpx.post(base + '/mcp', headers={'Authorization': 'Bearer ' + token}, json={}, trust_env=False).status_code == 401
            assert not errors, errors
            print('PASS Chromium UI: sign-in, consent, endpoint, live MCP content, sources, pause/manual edit/resume, multi-file upload, permissions, exact approval, persistence, finalization and revocation')
            print('Disposable local SDK/browser test only; not real Claude or ChatGPT acceptance.')
            context.close()
        finally:
            browser.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', required=True)
    run(parser.parse_args().url.rstrip('/'))
