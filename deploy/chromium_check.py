"""Read-only sandbox-process acceptance for explicitly disposable container tests."""
import os
from pathlib import Path

from playwright.sync_api import sync_playwright

assert os.environ.get('ZOOMZ_CONTAINER_TEST') == '1', 'Disposable container test opt-in required'
assert os.getuid() == 10001, 'Expected non-root production UID'

with sync_playwright() as runtime:
    browser = runtime.chromium.launch(headless=True, chromium_sandbox=True, timeout=10000,
        env={k: v for k, v in os.environ.items() if k in {'PATH', 'LANG', 'TMPDIR', 'PLAYWRIGHT_BROWSERS_PATH'}})
    try:
        page = browser.new_page()
        page.set_content('<p>Sandbox process acceptance</p>')
        processes = browser.new_browser_cdp_session().send('SystemInfo.getProcessInfo')['processInfo']
        browser_pid = next(int(p['id']) for p in processes if p['type'] == 'browser')
        arguments = Path(f'/proc/{browser_pid}/cmdline').read_bytes().split(b'\0')
        browser_uid_map = Path(f'/proc/{browser_pid}/uid_map').read_text()
        browser_status = dict(line.split(':', 1) for line in Path(f'/proc/{browser_pid}/status').read_text().splitlines() if ':' in line)
        browser_filters = int(browser_status['Seccomp_filters'].strip())
        forbidden = {b'--no-sandbox', b'--disable-namespace-sandbox', b'--disable-seccomp-filter-sandbox', b'--disable-setuid-sandbox'}
        assert not forbidden.intersection(arguments), 'Browser sandbox disabling flags are forbidden'
        renderer_ids = [int(p['id']) for p in processes if p['type'] == 'renderer']
        assert renderer_ids, 'A real renderer process is required'
        for pid in renderer_ids:
            status = dict(line.split(':', 1) for line in Path(f'/proc/{pid}/status').read_text().splitlines() if ':' in line)
            assert set(status['Uid'].split()) == {'10001'}
            renderer_uid_map = Path(f'/proc/{pid}/uid_map').read_text()
            assert renderer_uid_map.strip() and renderer_uid_map != browser_uid_map, 'Renderer must use a distinct user namespace'
            assert status['NoNewPrivs'].strip() == '1'
            assert status['Seccomp'].strip() == '2'
            assert int(status['CapEff'].strip(), 16) == 0
            assert len(status['NSpid'].split()) > 1, 'Renderer must run inside a nested PID namespace'
            assert int(status['Seccomp_filters'].strip()) > browser_filters, 'Renderer must add seccomp filters beyond its browser parent'
            print('Renderer sandbox verified:', {k: status[k].strip() for k in ('Uid', 'NSpid', 'NoNewPrivs', 'Seccomp', 'Seccomp_filters', 'CapEff')})
            print('Renderer user-namespace UID map:', renderer_uid_map.strip())
            print('Browser-parent seccomp filter count:', browser_filters)
    finally:
        browser.close()
