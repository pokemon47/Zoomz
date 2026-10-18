"""Built-frontend regression checks without backend startup or account data."""
import os

import pytest


def test_editor_and_mcp_migrations_share_one_head():
    from pathlib import Path
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    backend = Path(__file__).resolve().parents[1]
    config = Config(str(backend / "alembic.ini"))
    config.set_main_option("script_location", str(backend / "alembic"))
    scripts = ScriptDirectory.from_config(config)
    assert len(scripts.get_heads()) == 1
    ancestry = {revision.revision for revision in scripts.walk_revisions()}
    assert {"a1c4e2f9b7d3", "a90b4a770001"} <= ancestry


@pytest.mark.skipif(os.environ.get("ZOOMZ_BROWSER_TESTS") != "1", reason="Requires built frontend and Chromium")
@pytest.mark.parametrize("path", ["/mcp-render", "/demo"])
def test_canvas_initial_bounds_and_source_dialog(path):
    from playwright.sync_api import expect, sync_playwright

    origin = os.environ.get("MCP_RENDER_ORIGIN", "http://127.0.0.1:5178")
    nodes = [
        {"id": "root", "type": "board", "parentId": None, "x": 0, "y": 0, "w": 1000, "h": 800, "content": {"title": "Root"}},
        {"id": "cited-note", "type": "note", "parentId": "root", "x": 30, "y": 40, "z": 0, "w": 350, "h": 280,
         "content": {"title": "Source note", "body": "BFS uses a queue", "references": [
             {"title": "Lecture 1", "classification": "source", "availability": "missing"}]}},
    ]
    bounds = {"x": 0, "y": 0, "w": 430, "h": 340}
    snapshot = {"space": {"id": "render-fixture", "title": "Root", "role": "viewer", "scenery": "studio", "workspaceId": ""},
                "rootBoardId": "root", "seq": 0, "nodes": nodes, "boardRoles": {}}
    with sync_playwright() as runtime:
        browser = runtime.chromium.launch(headless=True, chromium_sandbox=True)
        try:
            context = browser.new_context(viewport={"width": 1000, "height": 720}, reduced_motion="reduce")
            context.add_init_script("localStorage.setItem('zoomz.scenery', 'studio')")
            errors = []
            page = context.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))

            def api(route):
                if route.request.url.endswith("/api/mcp/preview-scene"):
                    route.fulfill(json={"snapshot": snapshot, "bounds": bounds})
                elif route.request.url.endswith("/api/demo-board"):
                    route.fulfill(json={"rootBoardId": "root", "nodes": nodes})
                else:
                    route.fulfill(status=401, json={"detail": "Isolated test"})

            context.route("**/api/**", api)
            context.route_web_socket("**/*", lambda socket: socket.close())
            page.goto(origin + path)
            note = page.locator('[data-item="cited-note"]')
            expect(note).to_be_visible()
            if path == "/mcp-render":
                scale = min(1000 / bounds["w"], 720 / bounds["h"]) * 0.92
                box = note.bounding_box()
                assert box is not None
                assert box["width"] == pytest.approx(350 * scale, abs=1)
                assert box["x"] == pytest.approx(500 + (30 - 215) * scale, abs=1)
                assert box["y"] == pytest.approx(360 + (40 - 170) * scale, abs=1)
            else:
                note.focus()
                page.get_by_role("button", name="Sources · 1").click()
                expect(page.get_by_role("dialog")).to_be_visible()
                expect(page.get_by_role("heading", name="Lecture 1")).to_be_visible()
                page.keyboard.press("Escape")
                expect(page.get_by_role("dialog")).not_to_be_visible()
            assert not errors
        finally:
            browser.close()
