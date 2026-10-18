"""UI acceptance on an explicitly selected disposable loopback development instance."""
import argparse
import base64
import hashlib
import io
import re
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import anyio
import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from playwright.sync_api import sync_playwright, expect
from PIL import Image


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
            email = 'mcp-browser-' + uuid4().hex + '@example.com'
            page.get_by_label('Email', exact=True).fill(email)
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
                                if name == 'get_source_visual':
                                    assert any(item.type == 'image' for item in result.content), 'Actual MCP source image required'
                                return result.structuredContent
                with ThreadPoolExecutor(max_workers=1) as worker:
                    return worker.submit(anyio.run, invoke).result(timeout=35)
            workspace = api('/api/spaces')['workspaces'][0]['id']
            made = tool('create_moodboard', {'workspace_id': workspace, 'title': 'Browser acceptance', 'idempotency_key': 'browser-root'})
            space, root = made['space_id'], made['board_id']
            page.goto(base + '/b/' + space)
            expect(page.locator('.zb-viewport')).to_be_visible()
            expect(page.locator('.zb-status.is-live')).to_be_visible()
            second_context = browser.new_context(viewport={'width': 1440, 'height': 1000}, reduced_motion='reduce')
            second = second_context.new_page()
            second.on('pageerror', lambda error: errors.append(str(error)))
            collaborator_email = 'mcp-collaborator-' + uuid4().hex + '@example.com'
            invitation = api(f'/api/spaces/{space}/invites', {'email': collaborator_email, 'role': 'editor'})
            invitation_token = invitation['devLink'].rsplit('/', 1)[1]
            second.goto(base + '/login?next=/ai')
            second.get_by_label('Email', exact=True).fill(collaborator_email)
            second.get_by_role('button', name='Email me a sign-in link', exact=True).click()
            second.get_by_role('link', name='Open sign-in link (development)', exact=True).click()
            second.wait_for_url(base + '/ai')
            accepted = second_context.request.post(base + '/api/invites/' + invitation_token + '/accept', data={}, headers={'X-Zoomz': '1'})
            assert accepted.ok
            second.goto(base + '/b/' + space)
            expect(second.locator('.zb-status.is-live')).to_be_visible()
            task = tool('generation_task', {'action': 'create', 'space_id': space, 'board_id': root, 'objective': 'Browser draft acceptance'})
            created = tool('apply_canvas_batch', {'batch': {'space_id': space, 'expected_revision': 0, 'idempotency_key': 'browser-content', 'task_id': task['id'], 'operations': [
                {'type': 'create', 'ref': 'note', 'node': {'type': 'note', 'parentId': root, 'x': 30, 'y': 40, 'z': 40, 'w': 380, 'h': 280, 'content': {'title': 'Source note', 'body': 'BFS uses a queue', 'references': [{'title': 'Lecture 1', 'classification': 'source', 'availability': 'missing'}]}}},
                {'type': 'create', 'ref': 'topic', 'node': {'type': 'board', 'parentId': root, 'x': 500, 'y': 40, 'w': 450, 'h': 350, 'content': {'title': 'Topic'}}},
                {'type': 'create', 'ref': 'nested', 'node': {'type': 'board', 'parentId': '$topic', 'x': 40, 'y': 40, 'w': 400, 'h': 330, 'content': {'title': 'Nested topic'}}},
            ]}})
            note = page.locator(f'[data-item="{created["ids"]["note"]}"]')
            expect(note).to_be_visible()
            second_note = second.locator(f'[data-item="{created["ids"]["note"]}"]')
            expect(second_note).to_be_visible()
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
            note.click()
            note.press('Enter')
            page.get_by_role('dialog').get_by_role('textbox', name='Note', exact=True).fill('Manual correction to MCP content')
            page.get_by_role('dialog').get_by_role('button', name='Save', exact=True).click()
            expect(second_note).to_have_attribute('aria-label', re.compile('Manual correction to MCP content'))
            page.keyboard.press('ControlOrMeta+z')
            expect(second_note).to_have_attribute('aria-label', re.compile('BFS uses a queue'))
            box = note.bounding_box()
            grab = {'x': box['x'] + box['width'] / 2, 'y': box['y'] + box['height'] / 2}
            page.mouse.move(**grab)
            page.mouse.down()
            page.mouse.move(grab['x'] + 60, grab['y'] + 45, steps=8)
            page.mouse.up()
            expect(page.locator('.zb-status.is-live')).to_be_visible()
            moved = next(n for n in api(f'/api/spaces/{space}/scene')['nodes'] if n['id'] == created['ids']['note'])
            assert moved['x'] != 30 and moved['y'] != 40 and moved['z'] == 40
            page.keyboard.press('ControlOrMeta+z')
            expect(page.locator('.zb-status.is-live')).to_be_visible()
            restored = next(n for n in api(f'/api/spaces/{space}/scene')['nodes'] if n['id'] == created['ids']['note'])
            assert (restored['x'], restored['y']) == (30, 40)
            handle = page.get_by_role('button', name='Resize Source note', exact=True)
            handle_box = handle.bounding_box()
            page.mouse.move(handle_box['x'] + handle_box['width'] / 2, handle_box['y'] + handle_box['height'] / 2)
            page.mouse.down()
            page.mouse.move(handle_box['x'] + 50, handle_box['y'] + 45, steps=8)
            page.mouse.up()
            expect(page.locator('.zb-status.is-live')).to_be_visible()
            resized = next(n for n in api(f'/api/spaces/{space}/scene')['nodes'] if n['id'] == created['ids']['note'])
            assert resized['w'] != 380 and resized['h'] != 280
            page.keyboard.press('ControlOrMeta+z')
            expect(page.locator('.zb-status.is-live')).to_be_visible()
            page.get_by_role('button', name='Add', exact=True).click()
            page.get_by_role('menuitem', name=re.compile(r'^Note(?:\s+N)?$')).click()
            dialog = page.get_by_role('dialog')
            dialog.get_by_label('Title', exact=True).fill('Manual edit while paused')
            dialog.get_by_label('Note', exact=True).fill('Keep this manual content')
            dialog.get_by_role('button', name='Add note', exact=True).click()
            expect(page.get_by_role('group', name=re.compile('Note: Manual edit while paused'))).to_be_visible()
            expect(second.get_by_role('group', name=re.compile('Note: Manual edit while paused'))).to_be_visible()
            page.keyboard.press('ControlOrMeta+z')
            expect(page.get_by_role('group', name=re.compile('Note: Manual edit while paused'))).to_have_count(0)
            expect(second.get_by_role('group', name=re.compile('Note: Manual edit while paused'))).to_have_count(0)
            page.keyboard.press('ControlOrMeta+Shift+z')
            expect(page.get_by_role('group', name=re.compile('Note: Manual edit while paused'))).to_be_visible()
            draft.locator('summary').click()
            draft.get_by_role('button', name='Resume writes', exact=True).click()
            expect(draft.locator('summary')).to_contain_text('generating')
            document, diagram = io.BytesIO(), io.BytesIO()
            image = Image.new('RGB', (240, 160), 'orange')
            image.save(diagram, 'PNG')
            image.save(document, 'PDF', save_all=True, append_images=[Image.new('RGB', (240, 160), 'blue')])
            page.locator('input[type=file]').set_input_files([
                {'name': 'lecture-a.txt', 'mimeType': 'text/plain', 'buffer': b'Graph theory source'},
                {'name': 'lecture-b.txt', 'mimeType': 'text/plain', 'buffer': b'Sorting source'},
                {'name': 'lecture.pdf', 'mimeType': 'application/pdf', 'buffer': document.getvalue()},
                {'name': 'diagram.png', 'mimeType': 'image/png', 'buffer': diagram.getvalue()},
            ])
            expect(page.get_by_role('group', name='File: lecture-a.txt', exact=True)).to_be_visible()
            expect(page.get_by_role('group', name='File: lecture-b.txt', exact=True)).to_be_visible()
            deadline = time.monotonic() + 10
            while True:
                scene = api(f'/api/spaces/{space}/scene')
                sources = {n['content']['title']: n['content']['fileId'] for n in scene['nodes'] if n['content'].get('fileId')}
                if {'lecture-a.txt', 'lecture-b.txt', 'lecture.pdf', 'diagram'} <= sources.keys():
                    break
                assert time.monotonic() < deadline, 'All four originals must be persisted'
                time.sleep(0.1)
            expect(page.locator('.zb-status.is-live')).to_be_visible()
            citation_batch = {'space_id': space, 'expected_revision': scene['seq'], 'idempotency_key': 'associate-original', 'task_id': task['id'], 'operations': [
                {'type': 'update', 'id': created['ids']['note'], 'patch': {'content': {'references': [{'title': 'Graph theory original', 'filename': 'lecture-a.txt', 'asset_id': sources['lecture-a.txt'], 'classification': 'source', 'availability': 'available'}]}}},
            ]}
            cited = tool('apply_canvas_batch', {'batch': citation_batch})
            if cited.get('error') == 'revision_conflict':
                inspected = tool('get_board', {'space_id': space, 'board_id': root})
                cited = tool('apply_canvas_batch', {'batch': {**citation_batch, 'expected_revision': inspected['revision'], 'idempotency_key': 'associate-original-after-inspection'}})
            assert 'revision' in cited, cited
            note.click()
            page.get_by_role('button', name='Sources · 1', exact=True).click()
            original = page.get_by_role('dialog').get_by_role('link', name='Open original', exact=True)
            expect(original).to_have_attribute('href', re.compile('/api/files/' + sources['lecture-a.txt'] + '/original'))
            original_response = request.get(base + original.get_attribute('href'))
            assert original_response.ok and original_response.body() == b'Graph theory source'
            assert httpx.get(base + f'/api/mcp/sources/{sources["lecture-a.txt"]}', trust_env=False).status_code == 401
            assert httpx.get(base + f'/api/files/{sources["lecture-a.txt"]}/original', trust_env=False).status_code == 404
            page.keyboard.press('Escape')
            visual = tool('get_source_visual', {'space_id': space, 'file_id': sources['lecture.pdf'], 'page': 2})
            assert visual['page'] == 2 and visual['page_count'] == 2, visual
            topic = second.locator(f'[data-item="{created["ids"]["topic"]}"]')
            topic.press('Enter')
            path = second.get_by_role('navigation', name='Board path')
            expect(path.locator('[aria-current=page]')).to_have_text('Topic')
            second.locator(f'[data-item="{created["ids"]["nested"]}"]').press('Enter')
            expect(path.locator('[aria-current=page]')).to_have_text('Nested topic')
            path.get_by_role('button', name='Topic', exact=True).click()
            expect(path.locator('[aria-current=page]')).to_have_text('Topic')
            path.get_by_role('button', name='Browser acceptance', exact=True).click()
            expect(path.locator('[aria-current=page]')).to_have_text('Browser acceptance')
            page.goto(base + '/ai')
            page.get_by_label('Inspect a moodboard').select_option(space)
            expect(page.locator('code').filter(has_text=created['ids']['topic'])).to_be_visible()
            page.get_by_role('combobox', name='Access scope', exact=True).select_option('boards')
            page.get_by_label('Board IDs, separated by commas. Use the board picker below.').fill(created['ids']['topic'])
            with page.expect_response(lambda r: '/api/mcp/connections/' in r.url and r.request.method == 'PUT') as saved:
                page.get_by_role('button', name='Save permissions', exact=True).click()
            assert saved.value.ok
            assert tool('get_board', {'space_id': space, 'board_id': root})['status'] == 403
            assert tool('get_board', {'space_id': space, 'board_id': created['ids']['topic']})['board']['id'] == created['ids']['topic']
            page.get_by_role('combobox', name='Access scope', exact=True).select_option('all')
            with page.expect_response(lambda r: '/api/mcp/connections/' in r.url and r.request.method == 'PUT') as saved:
                page.get_by_role('button', name='Save permissions', exact=True).click()
            assert saved.value.ok
            assert tool('get_board', {'space_id': space, 'board_id': root})['board']['id'] == root
            page.get_by_role('combobox', name='Access scope', exact=True).select_option('workspaces')
            page.locator('fieldset input[type=checkbox]').first.check()
            page.get_by_label('Allow creation and editing').uncheck()
            with page.expect_response(lambda r: '/api/mcp/connections/' in r.url and r.request.method == 'PUT') as saved:
                page.get_by_role('button', name='Save permissions', exact=True).click()
            assert saved.value.ok
            assert tool('create_moodboard', {'workspace_id': workspace, 'title': 'Denied', 'idempotency_key': 'read-only-denied'})['status'] == 403
            page.get_by_label('Allow creation and editing').check()
            with page.expect_response(lambda r: '/api/mcp/connections/' in r.url and r.request.method == 'PUT') as saved:
                page.get_by_role('button', name='Save permissions', exact=True).click()
            assert saved.value.ok
            scene = api(f'/api/spaces/{space}/scene')
            removal = {'space_id': space, 'expected_revision': scene['seq'], 'idempotency_key': 'approved-remove', 'operations': [{'type': 'delete', 'id': created['ids']['note']}]}
            approval = tool('apply_canvas_batch', {'batch': removal})
            assert approval['error'] == 'approval_required'
            page.get_by_role('button', name='Refresh', exact=True).click()
            page.get_by_role('button', name='Approve these exact operations', exact=True).click()
            expect(page.get_by_role('button', name='Approved; assistant may retry', exact=True)).to_be_visible()
            assert 'revision' in tool('apply_canvas_batch', {'batch': removal})
            expect(second_note).to_have_count(0)
            page.get_by_role('button', name='Load snapshots', exact=True).click()
            recover = page.get_by_role('button', name='Restore snapshot', exact=True).first
            expect(recover).to_be_disabled()
            page.get_by_label('Type RESTORE SNAPSHOT to enable recovery').fill('RESTORE SNAPSHOT')
            recover.click()
            expect(page.get_by_role('status').filter(has_text='Snapshot restored.')).to_be_visible()
            expect(second_note).to_be_visible()
            page.get_by_label('Destructive operations').select_option('elevated')
            page.get_by_label('Elevation duration').select_option('task')
            page.get_by_label('Task ID', exact=True).fill(task['id'])
            with page.expect_response(lambda r: '/api/mcp/connections/' in r.url and r.request.method == 'PUT') as saved:
                page.get_by_role('button', name='Save permissions', exact=True).click()
            assert saved.value.ok
            scene = api(f'/api/spaces/{space}/scene')
            elevated = tool('apply_canvas_batch', {'batch': {**removal, 'expected_revision': scene['seq'], 'idempotency_key': 'elevated-remove', 'task_id': task['id']}})
            assert 'revision' in elevated, elevated
            expect(second_note).to_have_count(0)
            page.get_by_label('Destructive operations').select_option('approve')
            with page.expect_response(lambda r: '/api/mcp/connections/' in r.url and r.request.method == 'PUT') as saved:
                page.get_by_role('button', name='Save permissions', exact=True).click()
            assert saved.value.ok
            page.goto(base + '/b/' + space)
            expect(page.get_by_role('group', name=re.compile('Note: Manual edit while paused'))).to_be_visible()
            expect(page.locator(f'[data-item="{created["ids"]["note"]}"]')).to_have_count(0)
            draft = page.locator('details').filter(has=page.locator('summary', has_text='Browser draft acceptance'))
            draft.locator('summary').click()
            draft.get_by_role('button', name='Finalize', exact=True).click()
            expect(draft.locator('summary')).to_contain_text('completed')
            assert next(t for t in tool('generation_task', {'action': 'list'})['tasks'] if t['id'] == task['id'])['state'] == 'completed'
            page.goto(base + '/ai')
            page.get_by_role('button', name='Revoke connection', exact=True).click()
            expect(page.get_by_role('heading', name='Browser acceptance · Revoked')).to_be_visible()
            assert httpx.post(base + '/mcp', headers={'Authorization': 'Bearer ' + token}, json={}, trust_env=False).status_code == 401
            assert not errors, errors
            print('PASS Chromium UI: sign-in, consent, live edits in two authenticated sessions, root/child/grandchild navigation, MCP content editing and undo, pause/manual edit/resume, bulk upload and exact protected source association, permissions, approval, recovery, task elevation, persistence, UI finalization and revocation')
            print('Disposable local SDK/browser test only; not real Claude or ChatGPT acceptance.')
            context.close()
            second_context.close()
        finally:
            browser.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', required=True)
    run(parser.parse_args().url.rstrip('/'))
