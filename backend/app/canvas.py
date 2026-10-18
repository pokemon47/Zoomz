"""Whole canvases: duplicate one, or import an exported canvas (zip) as a new one.

A canvas is a space: a root board and everything nested in it. Both operations build a new
space with fresh ids for every item, keeping positions, sizes, heights, stacking, captions,
text, arrows (re-pointed at the copies) and the canvas's scenery, and copy the files along.
"""

from __future__ import annotations

import io
import json
import uuid
import zipfile
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import storage
from .auth import require_user
from .config import settings
from .db import get_db
from .files import ingest
from .models import RANK, Node, Space, SpaceMember, StoredFile, User, Workspace, WorkspaceMember, new_id
from .ops import DEFAULT_FRAME, TYPES, OpError, _clean_content, _num, search_text
from .permissions import require_space
from .ratelimit import limit

router = APIRouter(prefix="/api", tags=["canvas"])

MAX_NODES = 20_000
STATIC_PREFIX = "/api/assets/"


def _target_workspace(db: Session, user: User, wanted: Optional[str], fallback: Optional[str] = None) -> Workspace:
    """Where a new canvas goes: the workspace asked for, else `fallback`, else your Personal one.
    You need to be able to edit there."""
    for ws_id in (wanted, fallback):
        if not ws_id:
            continue
        wm = db.get(WorkspaceMember, (ws_id, user.id))
        if wm and RANK[wm.role] >= RANK["editor"]:
            return db.get(Workspace, ws_id)
        if ws_id == wanted:
            raise HTTPException(403, "You can't add canvases to that workspace.")
    ws = db.scalar(select(Workspace).where(Workspace.owner_id == user.id, Workspace.personal.is_(True)))
    if not ws:
        raise HTTPException(409, "You don't have a workspace to put it in.")
    return ws


def build_space(db: Session, ws: Workspace, user: User, title: str, scenery: str, root_id: str, nodes: list[dict[str, Any]]) -> tuple[Space, dict[str, str]]:
    """Insert a new space from node dicts (id, type, parentId, x, y, z, w, h, rank, content).
    Every item gets a new id; parents and arrow ends are re-pointed. Returns the space and the
    old → new id map. File references are left for the caller. Doesn't commit."""
    by_id = {n["id"]: n for n in nodes}
    if root_id not in by_id:
        raise HTTPException(422, "That canvas has no top board.")
    fresh = {old: f"{(by_id[old]['type'] or 'item')[:5]}-{uuid.uuid4().hex[:20]}" for old in by_id}
    children: dict[str, list[dict[str, Any]]] = {}
    for n in nodes:
        if n["id"] == root_id:
            continue
        parent = n.get("parentId")
        if parent not in by_id or by_id[parent]["type"] != "board":
            parent = root_id  # orphans land on the top board rather than being lost
        children.setdefault(parent, []).append(n)

    space = Space(workspace_id=ws.id, title=title, root_board_id=fresh[root_id], scenery=(scenery or "mountains")[:20], created_by=user.id)
    db.add(space)
    db.flush()
    db.add(SpaceMember(space_id=space.id, user_id=user.id, role="owner"))

    order, queue, seen = [], [(by_id[root_id], None)], set()
    while queue:
        n, parent = queue.pop(0)
        if n["id"] in seen:
            continue
        seen.add(n["id"])
        order.append((n, parent))
        queue += [(k, n["id"]) for k in children.get(n["id"], [])]

    for n, parent in order:
        type_ = n["type"]
        try:
            content = _clean_content(type_, dict(n.get("content") or {}), partial=False)
        except OpError as e:
            raise HTTPException(422, f"An item couldn't be read: {e}")
        if type_ == "board":
            content.setdefault("frame", dict(DEFAULT_FRAME))
            if parent is None:
                content["title"] = title
        if type_ == "arrow":
            for k in ("from", "to"):
                content[k] = fresh.get(content.get(k) or "") if content.get(k) else None
        try:
            db.add(
                Node(
                    id=fresh[n["id"]],
                    space_id=space.id,
                    parent_id=fresh[parent] if parent else None,
                    type=type_,
                    x=_num(n.get("x", 0), -1e6, 1e6, "x"),
                    y=_num(n.get("y", 0), -1e6, 1e6, "y"),
                    z=_num(n.get("z") or 0, 0, 400, "z"),
                    w=_num(n.get("w", 200), 20, 20000, "w"),
                    h=_num(n.get("h", 200), 20, 20000, "h"),
                    rank=_num(n["rank"], -1e9, 1e9, "rank") if n.get("rank") is not None else None,
                    content=content,
                    search_text=search_text(type_, content),
                    created_by=user.id,
                )
            )
        except OpError as e:
            raise HTTPException(422, f"An item couldn't be read: {e}")
        db.flush()
    return space, fresh


# ---------------------------------------------------------------- duplicate


class DuplicateIn(BaseModel):
    workspaceId: Optional[str] = None
    title: Optional[str] = None


@router.post("/spaces/{space_id}/duplicate")
def duplicate(space_id: str, request: Request, body: DuplicateIn = DuplicateIn(), user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    """A full copy of a canvas: every item, where it sits, its files and the scenery."""
    src, _ = require_space(db, space_id, user, "viewer")
    limit(request, "duplicate", 20, 10, key=user.id)
    ws = _target_workspace(db, user, body.workspaceId, src.workspace_id)
    nodes = [
        {"id": n.id, "type": n.type, "parentId": n.parent_id, "x": n.x, "y": n.y, "z": n.z, "w": n.w, "h": n.h, "rank": n.rank, "content": dict(n.content or {})}
        for n in db.scalars(select(Node).where(Node.space_id == src.id))
    ]
    title = (body.title or f"{src.title} (copy)").strip()[:120] or src.title
    # Copy the files into the new space and point the copies' items at them.
    space, _ = build_space(db, ws, user, title, src.scenery, src.root_board_id, nodes)
    file_map: dict[str, str] = {}
    for f in db.scalars(select(StoredFile).where(StoredFile.space_id == src.id)):
        nid = new_id()
        for name in {"original", *(f.variants or {}).values()}:
            try:
                storage.copy(f"{src.id}/{f.id}/{name}", f"{space.id}/{nid}/{name}")
            except FileNotFoundError:
                pass
        db.add(StoredFile(id=nid, space_id=space.id, uploader_id=user.id, filename=f.filename, mime=f.mime, kind=f.kind, size=f.size,
                          sha256=f.sha256, width=f.width, height=f.height, variants=dict(f.variants or {}), status=f.status))
        file_map[f.id] = nid
    db.flush()
    _repoint_files(db, space, file_map)
    db.commit()
    from .spaces import space_summary

    return space_summary(db, space, "owner")


def _repoint_files(db: Session, space: Space, file_map: dict[str, str]) -> None:
    for n in db.scalars(select(Node).where(Node.space_id == space.id)):
        c = dict(n.content or {})
        if c.get("fileId") in file_map:
            c["fileId"] = file_map[c["fileId"]]
            n.content = c


# ---------------------------------------------------------------- import


@router.post("/spaces/import")
def import_canvas(request: Request, file: UploadFile = File(...), workspaceId: Optional[str] = Form(None), user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    """Import a canvas exported from Zoomz (a zip with zoomz-manifest.json) as a new canvas,
    exactly as it was laid out."""
    limit(request, "import", 10, 5, key=user.id)
    ws = _target_workspace(db, user, workspaceId or request.query_params.get("workspaceId"))
    raw = file.file.read(settings.max_upload_mb * 1024 * 1024 + 1)
    if len(raw) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f"Canvas files can be up to {settings.max_upload_mb} MB.")
    try:
        z = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile:
        raise HTTPException(422, "That isn't a Zoomz canvas export (.zip).")
    with z:
        infos = {i.filename: i for i in z.infolist() if not i.is_dir()}
        if sum(i.file_size for i in infos.values()) > settings.space_quota_mb * 1024 * 1024:
            raise HTTPException(413, "That canvas is bigger than a canvas can hold.")
        manifest_name = min((n for n in infos if n.rsplit("/", 1)[-1] == "zoomz-manifest.json"), key=len, default=None)
        if not manifest_name:
            raise HTTPException(422, "That zip has no zoomz-manifest.json, so its layout can't be rebuilt.")
        try:
            m = json.loads(z.read(manifest_name))
            raw_nodes = m["nodes"]
            root_id = m.get("rootBoardId") or next(n["id"] for n in raw_nodes if not n.get("parentId"))
        except (ValueError, KeyError, StopIteration, TypeError):
            raise HTTPException(422, "The canvas manifest couldn't be read.")
        if not isinstance(raw_nodes, list) or len(raw_nodes) > MAX_NODES:
            raise HTTPException(422, "The canvas manifest couldn't be read.")

        nodes: list[dict[str, Any]] = []
        for e in raw_nodes:
            if not isinstance(e, dict) or e.get("type") not in TYPES or not isinstance(e.get("id"), str):
                continue
            nodes.append({**e, "content": _content_of(e)})
        root_title = next((str(n["content"].get("title") or "") for n in nodes if n["id"] == root_id), "") or str((m.get("space") or {}).get("title") or "Imported canvas")
        scenery = str((m.get("space") or {}).get("scenery") or "mountains")

        space, fresh = build_space(db, ws, user, root_title[:120], scenery, root_id, nodes)
        db.commit()
        # Then the files, each through the normal upload checks (type, size, scanning, SVG
        # sanitising, previews), pointed at their items.
        for e in nodes:
            path = e.get("path")
            if e["type"] not in ("image", "file") or not isinstance(path, str) or path not in infos:
                continue
            n = db.get(Node, fresh.get(e["id"], ""))
            if not n or str((n.content or {}).get("src") or "").startswith(STATIC_PREFIX):
                continue  # built-in artwork keeps pointing at the copy that ships with the app
            try:
                with z.open(infos[path]) as fh:
                    rec = ingest(db, space, user, io.BytesIO(fh.read()), path.rsplit("/", 1)[-1])
            except HTTPException:
                continue  # one refused file doesn't sink the whole canvas; its card stays
            c = dict(n.content or {})
            c["fileId"] = rec.id
            c.pop("src", None)
            n.content = c
        db.commit()
    from .spaces import space_summary

    return space_summary(db, space, "owner")


def _content_of(e: dict[str, Any]) -> dict[str, Any]:
    """An item's content from a manifest entry: v2 stores it whole; v1 had loose fields."""
    if isinstance(e.get("content"), dict):
        c = dict(e["content"])
    else:
        c = {k: e[k] for k in ("title", "body", "description", "alt", "url") if e.get(k) is not None}
        if e.get("frame"):
            c["frame"] = e["frame"]
    if e["type"] == "board" and e.get("frame") and "frame" not in c:
        c["frame"] = e["frame"]
    c.pop("fileId", None)
    if c.get("src") and not str(c["src"]).startswith(STATIC_PREFIX):
        c.pop("src")
    return c
