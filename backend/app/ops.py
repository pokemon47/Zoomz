"""Edits to a space, as operations.

Every change — from the live socket or the REST API — goes through `apply()`: it checks
permissions and invariants, writes the database, bumps the space's sequence number and
returns the resulting changes to broadcast. The server's order is the truth: concurrent
edits to the same field resolve last-writer-wins, and every client converges because it
applies the server's results in sequence order.
"""

from __future__ import annotations

import math
import re
from typing import Any, Optional

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .models import Node, Op, Space, StoredFile, User, now
from .permissions import can_edit, role_at
from .storage import file_url

ID_RE = re.compile(r"^[A-Za-z0-9_-]{6,64}$")
TYPES = {"board", "image", "note", "file", "link"}
MAX_CHILDREN = 5000
MAX_BATCH = 500

# Content fields each node type may carry, with max string length.
CONTENT_FIELDS: dict[str, dict[str, int]] = {
    "board": {"title": 120, "description": 600},
    "image": {"title": 160, "alt": 600, "fileId": 32, "src": 300},
    # Notes have no practical length limit (the text shrinks to fit the note); this cap only
    # stops abuse — about 15,000 words.
    "note": {"title": 120, "body": 100_000},
    "file": {"title": 255, "fileId": 32},
    "link": {"url": 2000, "title": 300, "description": 600, "image": 2000, "site": 120, "embed": 2000},
}
DEFAULT_FRAME = {"x": 0, "y": 0, "w": 1300, "h": 1100}


class OpError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


# ---------------------------------------------------------------- serialization


def node_out(n: Node, files: dict[str, StoredFile] | None = None) -> dict[str, Any]:
    content = dict(n.content or {})
    fid = content.get("fileId")
    if fid:
        f = (files or {}).get(fid)
        content.update(file_urls(f) if f else {"status": "missing"})
    out = {"id": n.id, "type": n.type, "parentId": n.parent_id, "x": n.x, "y": n.y, "z": n.z, "w": n.w, "h": n.h, "content": content}
    if n.rank is not None:
        out["rank"] = n.rank
    return out


def file_urls(f: StoredFile) -> dict[str, Any]:
    v = f.variants or {}
    out: dict[str, Any] = {
        "src": file_url(f.id, "web" if "web" in v else "original"),
        "mime": f.mime,
        "size": f.size,
        "kind": f.kind,
        "status": f.status,
    }
    if f.width and f.height:
        out["width"], out["height"] = f.width, f.height
    for name in ("thumb_256", "thumb_1024", "poster", "preview"):
        if name in v:
            out[name] = file_url(f.id, name)
    return out


def files_for(db: Session, nodes: list[Node]) -> dict[str, StoredFile]:
    ids = {(n.content or {}).get("fileId") for n in nodes} - {None}
    if not ids:
        return {}
    return {f.id: f for f in db.scalars(select(StoredFile).where(StoredFile.id.in_(ids)))}


def search_text(type_: str, content: dict[str, Any]) -> str:
    parts = [str(content.get(k, "")) for k in ("title", "body", "description", "alt", "url", "site")]
    return " ".join(p for p in parts if p).lower()[:6000]


# ---------------------------------------------------------------- validation


def _num(v: Any, lo: float, hi: float, name: str) -> float:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        raise OpError(f"{name} must be a number")
    return float(min(max(v, lo), hi))


def _clean_content(type_: str, content: Any, partial: bool) -> dict[str, Any]:
    if not isinstance(content, dict):
        raise OpError("content must be an object")
    allowed = CONTENT_FIELDS[type_]
    out: dict[str, Any] = {}
    for k, v in content.items():
        if k == "frame" and type_ == "board":
            if not isinstance(v, dict):
                raise OpError("frame must be an object")
            out["frame"] = {
                "x": _num(v.get("x", 0), -1e6, 1e6, "frame.x"),
                "y": _num(v.get("y", 0), -1e6, 1e6, "frame.y"),
                "w": _num(v.get("w", 1300), 200, 1e6, "frame.w"),
                "h": _num(v.get("h", 1100), 200, 1e6, "frame.h"),
            }
            continue
        if k not in allowed:
            continue  # ignore derived fields clients echo back (src, thumbs, status…)
        if v is None:
            out[k] = None
            continue
        if not isinstance(v, str):
            raise OpError(f"{k} must be text")
        out[k] = v[: allowed[k]]
    if not partial and type_ == "board":
        out.setdefault("title", "Untitled board")
        out.setdefault("frame", dict(DEFAULT_FRAME))
    if not partial and type_ == "note":
        out.setdefault("title", "Note")
        out.setdefault("body", "")
    if "src" in out and out["src"] and not str(out["src"]).startswith("/api/assets/"):
        out.pop("src")  # only bundled demo art may be referenced directly; uploads go via fileId
    if "url" in out and out["url"] and not re.match(r"^https?://", out["url"]):
        raise OpError("links must start with http:// or https://")
    for k in ("image", "embed"):
        if out.get(k) and not re.match(r"^https://", out[k]):
            out.pop(k)
    return out


class Ctx:
    """One user editing one space."""

    def __init__(self, db: Session, space: Space, user: Optional[User], base_role: str):
        self.db, self.space, self.user, self.base_role = db, space, user, base_role
        self.changes: list[dict[str, Any]] = []

    def node(self, node_id: Any) -> Node:
        if not isinstance(node_id, str):
            raise OpError("id must be text")
        n = self.db.get(Node, node_id)
        if not n or n.space_id != self.space.id:
            raise OpError("That item no longer exists.", 404)
        return n

    def need_edit(self, board_id: Optional[str]) -> None:
        if not can_edit(role_at(self.db, self.space, self.base_role, self.user, board_id)):
            raise OpError("You can only view this board.", 403)

    def board(self, board_id: Any) -> Node:
        b = self.node(board_id)
        if b.type != "board":
            raise OpError("Things can only go inside boards.")
        return b

    def is_inside(self, node_id: str, maybe_ancestor: str) -> bool:
        cur: Optional[str] = node_id
        for _ in range(256):
            if cur is None:
                return False
            if cur == maybe_ancestor:
                return True
            n = self.db.get(Node, cur)
            cur = n.parent_id if n else None
        return True  # absurdly deep: treat as a cycle


def _create(ctx: Ctx, data: Any) -> None:
    if not isinstance(data, dict):
        raise OpError("node must be an object")
    nid, type_ = data.get("id"), data.get("type")
    if not isinstance(nid, str) or not ID_RE.match(nid):
        raise OpError("bad id")
    if type_ not in TYPES:
        raise OpError("unknown item type")
    if ctx.db.get(Node, nid):
        raise OpError("That id is already used.", 409)
    parent = ctx.board(data.get("parentId"))
    ctx.need_edit(parent.id)
    count = ctx.db.query(Node).filter(Node.parent_id == parent.id).count()
    if count >= MAX_CHILDREN:
        raise OpError("This board is full. Put things into a new board inside it.")
    content = _clean_content(type_, data.get("content") or {}, partial=False)
    fid = content.get("fileId")
    if type_ in ("image", "file") and fid:
        f = ctx.db.get(StoredFile, fid)
        if not f or f.space_id != ctx.space.id:
            raise OpError("That file isn't in this board's space.")
    n = Node(
        id=nid,
        space_id=ctx.space.id,
        parent_id=parent.id,
        type=type_,
        x=_num(data.get("x", 0), -1e6, 1e6, "x"),
        y=_num(data.get("y", 0), -1e6, 1e6, "y"),
        z=_num(data.get("z", 0), 0, 400, "z"),
        w=_num(data.get("w", 200), 20, 20000, "w"),
        h=_num(data.get("h", 200), 20, 20000, "h"),
        rank=_num(data["rank"], -1e9, 1e9, "rank") if data.get("rank") is not None else None,
        content=content,
        search_text=search_text(type_, content),
        created_by=ctx.user.id if ctx.user else None,
    )
    ctx.db.add(n)
    ctx.db.flush()
    ctx.changes.append({"kind": "upsert", "node": node_out(n, files_for(ctx.db, [n]))})


def _update(ctx: Ctx, data: Any) -> None:
    if not isinstance(data, dict):
        raise OpError("update must be an object")
    n = ctx.node(data.get("id"))
    patch = data.get("patch") or {}
    if not isinstance(patch, dict):
        raise OpError("patch must be an object")
    if n.parent_id is None and ("parentId" in patch or any(k in patch for k in ("x", "y"))):
        raise OpError("The top board can't be moved.")
    ctx.need_edit(n.parent_id if n.parent_id else n.id)
    if "parentId" in patch and patch["parentId"] != n.parent_id:
        new_parent = ctx.board(patch["parentId"])
        ctx.need_edit(new_parent.id)
        if n.type == "board" and ctx.is_inside(new_parent.id, n.id):
            raise OpError("A board can't go inside itself.")
        n.parent_id = new_parent.id
    for k, (lo, hi) in {"x": (-1e6, 1e6), "y": (-1e6, 1e6), "z": (0, 400), "w": (20, 20000), "h": (20, 20000)}.items():
        if k in patch:
            setattr(n, k, _num(patch[k], lo, hi, k))
    if "rank" in patch:
        n.rank = None if patch["rank"] is None else _num(patch["rank"], -1e9, 1e9, "rank")
    if "content" in patch:
        merged = {**(n.content or {}), **_clean_content(n.type, patch["content"], partial=True)}
        n.content = merged
        n.search_text = search_text(n.type, merged)
    n.updated_at = now()
    ctx.db.flush()
    ctx.changes.append({"kind": "upsert", "node": node_out(n, files_for(ctx.db, [n]))})


def _delete(ctx: Ctx, data: Any) -> None:
    if not isinstance(data, dict):
        raise OpError("delete must be an object")
    n = ctx.node(data.get("id"))
    if n.parent_id is None:
        raise OpError("The top board can't be deleted.")
    ctx.need_edit(n.parent_id)
    # Collect the subtree explicitly (portable across databases), deepest first.
    ids, frontier = [n.id], [n.id]
    while frontier:
        kids = list(ctx.db.scalars(select(Node.id).where(Node.parent_id.in_(frontier))))
        ids += kids
        frontier = kids
    ctx.db.execute(delete(Node).where(Node.id.in_(ids[::-1])))
    ctx.db.flush()
    ctx.changes.append({"kind": "remove", "id": n.id})


HANDLERS = {"create": _create, "update": _update, "delete": _delete}


def apply(db: Session, space: Space, user: Optional[User], base_role: str, op: Any) -> dict[str, Any]:
    """Apply one operation (or a batch) atomically. Returns the broadcast message."""
    if not isinstance(op, dict) or op.get("type") not in (*HANDLERS, "batch"):
        raise OpError("unknown operation")
    ops = op.get("ops") if op["type"] == "batch" else [op]
    if not isinstance(ops, list) or not ops or len(ops) > MAX_BATCH:
        raise OpError("a batch needs 1–500 operations")
    try:
        # Lock before reading/editing nodes, and refresh an already-loaded identity.
        # Concurrent PostgreSQL requests must not allocate the same sequence number.
        locked = db.scalar(select(Space).where(Space.id == space.id).with_for_update().execution_options(populate_existing=True))
        if locked is None:
            raise OpError("This board no longer exists.", 404)
        ctx = Ctx(db, locked, user, base_role)
        for o in ops:
            if not isinstance(o, dict) or o.get("type") not in HANDLERS:
                raise OpError("unknown operation")
            HANDLERS[o["type"]](ctx, o.get("node") if o["type"] == "create" else o)
        locked.seq += 1
        locked.updated_at = now()
        msg = {"t": "op", "seq": locked.seq, "by": user.id if user else None, "cid": op.get("cid"), "changes": ctx.changes}
        db.add(Op(space_id=space.id, seq=locked.seq, user_id=user.id if user else None, payload={"changes": _strip_urls(ctx.changes)}))
        db.commit()
        space.seq = locked.seq
        return msg
    except Exception:
        db.rollback()
        raise


def _strip_urls(changes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The op log stores ids only; signed file URLs are re-issued when replayed."""
    out = []
    for c in changes:
        if c["kind"] == "upsert":
            node = dict(c["node"])
            content = {k: v for k, v in node["content"].items() if k not in ("src", "thumb_256", "thumb_1024", "poster", "preview", "status", "mime", "size", "kind", "width", "height") or not node["content"].get("fileId")}
            node["content"] = content
            out.append({"kind": "upsert", "node": node})
        else:
            out.append(c)
    return out


def replay(db: Session, space: Space, since: int, limit: int = 2000) -> Optional[list[dict[str, Any]]]:
    """Ops after `since`, or None if the log no longer reaches back that far."""
    rows = list(db.scalars(select(Op).where(Op.space_id == space.id, Op.seq > since).order_by(Op.seq).limit(limit + 1)))
    if len(rows) > limit:
        return None
    if rows and rows[0].seq != since + 1:
        return None
    if not rows and since < space.seq:
        return None
    msgs = []
    for r in rows:
        changes = []
        for c in r.payload.get("changes", []):
            if c["kind"] == "upsert":
                n = db.get(Node, c["node"]["id"])
                if n is None:
                    continue  # removed later; a later op carries the removal
                changes.append({"kind": "upsert", "node": node_out(n, files_for(db, [n]))})  # latest state wins
            else:
                changes.append(c)
        msgs.append({"t": "op", "seq": r.seq, "by": r.user_id, "cid": None, "changes": changes})
    return msgs


def prune_log(db: Session, keep: int = 3000) -> None:
    for space in db.scalars(select(Space).where(Space.seq > keep)):
        db.execute(delete(Op).where(Op.space_id == space.id, Op.seq <= space.seq - keep))
    db.commit()
