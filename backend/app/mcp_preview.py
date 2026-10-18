"""Bounded screenshots of the real editor, without browser credentials or network media."""
import asyncio
import json
import mimetypes
import os
import threading
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, func, cast, Text

from .config import settings
from .mcp_access import atomic, authorize_board, connection_for
from .models import Node, Space
from . import ops, storage


class PreviewBounds(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    x: float = Field(ge=-1e6, le=1e6)
    y: float = Field(ge=-1e6, le=1e6)
    w: float = Field(ge=20, le=1e6)
    h: float = Field(ge=20, le=1e6)


@dataclass(frozen=True)
class PreviewScene:
    snapshot: dict
    assets: dict[str, tuple[Path, str]]


_render_slot = threading.BoundedSemaphore(1)


def preview_scene(connection_id, space_id, board_id):
    with atomic() as db:
        connection = connection_for(db, connection_id)
        space, _, _ = authorize_board(db, connection, space_id, board_id)
        # Keep one consistent scene revision while traversing the authorized subtree.
        db.scalar(select(Space).where(Space.id == space_id).with_for_update())
        db.refresh(space)
        root = db.get(Node, board_id)
        nodes, frontier, seen = [root], [board_id], {board_id}
        content_size = len(json.dumps(root.content).encode())
        for _ in range(64):
            if not frontier:
                break
            level = (Node.space_id == space_id, Node.parent_id.in_(frontier))
            content_size += db.scalar(select(func.sum(func.length(cast(Node.content, Text)))).where(*level)) or 0
            if content_size > 8 * 1024 * 1024:
                raise HTTPException(413, "Preview content exceeds 8 MiB")
            children = list(db.scalars(select(Node).where(*level).order_by(Node.id).limit(2001)))
            if len(nodes) + len(children) > 2000:
                raise HTTPException(413, "Preview supports at most 2000 nodes")
            frontier = []
            for node in children:
                if node.id in seen:
                    raise HTTPException(409, "Invalid preview hierarchy")
                seen.add(node.id)
                nodes.append(node)
                if node.type == "board":
                    frontier.append(node.id)
        if frontier:
            raise HTTPException(413, "Preview hierarchy exceeds 64 levels")
        files = {key: file for key, file in ops.files_for(db, nodes).items() if file.space_id == space_id}
        output = [ops.node_out(node, files) for node in nodes]
        output[0]["parentId"] = None
        snapshot = {"space": {"id": space.id, "title": root.content.get("title", "Board"), "role": "viewer", "scenery": space.scenery, "workspaceId": ""},
                    "rootBoardId": board_id, "seq": space.seq, "nodes": output, "boardRoles": {}}
        if len(json.dumps(snapshot).encode()) > 8 * 1024 * 1024:
            raise HTTPException(413, "Preview scene exceeds 8 MiB")
        assets = {}
        for file in files.values():
            for variant, name in {"original": "original", **(file.variants or {})}.items():
                mime = file.mime if variant == "original" else "image/webp"
                if not mime.startswith("image/"):
                    continue
                path = storage.path_for(f"{space.id}/{file.id}/{name}")
                if path.is_file() and path.stat().st_size <= 8 * 1024 * 1024:
                    assets[f"/api/files/{file.id}/{variant}"] = (path, mime)
        bundled = Path(__file__).parent / "static"
        for node in output:
            src = node["content"].get("src", "")
            if isinstance(src, str) and src.startswith("/api/assets/"):
                path = (bundled / src.removeprefix("/api/assets/")).resolve()
                mime = mimetypes.guess_type(path.name)[0] or ""
                if bundled.resolve() in path.parents and mime.startswith("image/") and path.is_file():
                    assets[urlsplit(src).path] = (path, mime)
        return PreviewScene(snapshot, assets)


def render_origin():
    origin = os.environ.get("MCP_RENDER_ORIGIN", settings.public_url if settings.dev else "http://127.0.0.1:8080").rstrip("/")
    url = urlsplit(origin)
    local = url.scheme == "http" and url.hostname in {"localhost", "127.0.0.1", "::1"}
    if url.username or url.password or url.path or url.query or url.fragment or not (local or origin == settings.public_url and url.scheme == "https"):
        raise HTTPException(503, "Render origin must be the app origin or an explicit HTTP loopback origin")
    return origin


def enabled():
    return os.environ.get("MCP_RENDER_PREVIEWS", "").lower() in {"1", "true"}


async def capture(scene, origin, width, height, bounds):
    from playwright.async_api import async_playwright

    blocked, errors = [], []
    async with async_playwright() as runtime:
        # Never silently disable Chromium's sandbox, even if a container cannot launch it.
        browser = await runtime.chromium.launch(headless=True, chromium_sandbox=True, timeout=10000,
            env={k: v for k, v in os.environ.items() if k in {"PATH", "LANG", "TMPDIR", "PLAYWRIGHT_BROWSERS_PATH"}})
        try:
            context = await browser.new_context(viewport={"width": width, "height": height}, device_scale_factor=1,
                reduced_motion="reduce", color_scheme="light", service_workers="block", accept_downloads=False)
            try:
                async def intercept(route):
                    request = route.request
                    url = urlsplit(request.url)
                    if f"{url.scheme}://{url.netloc}" != origin or request.method != "GET":
                        blocked.append(True)
                        return await route.abort()
                    if url.path == "/api/mcp/preview-scene":
                        return await route.fulfill(json={"snapshot": scene.snapshot, "bounds": bounds})
                    if url.path in scene.assets:
                        path, mime = scene.assets[url.path]
                        return await route.fulfill(path=path, content_type=mime, headers={"Cache-Control": "no-store"})
                    if url.path == "/api/me":
                        return await route.fulfill(status=401, json={"detail": "Read-only render"})
                    if url.path == "/api/auth/config":
                        return await route.fulfill(json={"google": False, "dev": False})
                    if url.path == "/mcp-render" or url.path.startswith(("/assets/", "/src/", "/@vite/", "/@react-refresh", "/node_modules/")):
                        return await route.continue_()
                    blocked.append(True)
                    await route.abort()
                await context.route("**/*", intercept)
                await context.route_web_socket("**/*", lambda socket: socket.close())
                page = await context.new_page()
                page.on("pageerror", lambda _: errors.append(True))
                await page.goto(origin + "/mcp-render", wait_until="domcontentloaded", timeout=12000)
                await page.locator('[data-mcp-ready="true"] .zb-viewport').wait_for(timeout=10000)
                await page.evaluate("async () => { await document.fonts.ready; await Promise.all([...document.images].map(i => i.decode().catch(() => {}))); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); }")
                if errors:
                    raise HTTPException(503, "Editor failed during preview rendering")
                image = await page.locator(".zb-viewport").screenshot(type="jpeg", quality=85, timeout=5000, animations="disabled")
                return {"image": image, "metadata": {"space_id": scene.snapshot["space"]["id"], "board_id": scene.snapshot["rootBoardId"],
                    "revision": scene.snapshot["seq"], "width": width, "height": height, "bounds": bounds,
                    "renderer": "Zoomz SpaceCanvas", "blocked_requests": len(blocked), "snapshot_not_live": True}}
            finally:
                await context.close()
        finally:
            await browser.close()


def get_board_preview(connection_id, space_id, board_id, width=1280, height=900, bounds=None):
    if not enabled():
        raise HTTPException(503, "Board previews are disabled; configure the sandboxed Chromium runtime first")
    if isinstance(width, bool) or isinstance(height, bool) or not isinstance(width, int) or not isinstance(height, int) or not 480 <= width <= 1600 or not 360 <= height <= 1200:
        raise HTTPException(400, "Preview dimensions must be 480–1600 by 360–1200")
    region = PreviewBounds.model_validate(bounds).model_dump() if bounds is not None else None
    origin = render_origin()
    if not _render_slot.acquire(blocking=False):
        raise HTTPException(429, "Another preview is rendering; retry later")
    try:
        scene = preview_scene(connection_id, space_id, board_id)
        result = asyncio.run(asyncio.wait_for(capture(scene, origin, width, height, region), timeout=25))
        with atomic() as db:
            authorize_board(db, connection_for(db, connection_id), space_id, board_id)
        return result
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(503, "Preview unavailable; verify Chromium sandbox, dependencies, and app origin") from None
    finally:
        _render_slot.release()
