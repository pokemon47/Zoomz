"""Real-time collaboration over one WebSocket per open board.

Messages (JSON, field `t`):
  client → server  op {cid, op} · presence {focus, cursor, view, path} · drag {id, x, y, parentId} · ping
  server → client  hello · op · reject · resync · presence · leave · drag · file · kicked · pong

Edits are applied in the order the server receives them and broadcast to everyone
(including the sender, whose `cid` acknowledges its optimistic change). Presence and
drag previews are relayed only, never stored. The API runs as a single instance, so
rooms live in memory.
"""

from __future__ import annotations

import asyncio
import itertools
import logging
import time
import math
from typing import Any, Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from starlette.concurrency import run_in_threadpool

from . import ops as ops_mod
from .auth import COOKIE, _aware
from .config import settings
from .db import SessionLocal
from .models import Space, User, UserSession, now
from .permissions import space_role
from .security import hash_token

log = logging.getLogger("zoomz.live")
router = APIRouter()
_ids = itertools.count(1)


class Conn:
    def __init__(self, ws: WebSocket, user: Optional[User], role: str):
        self.ws, self.user, self.role = ws, user, role
        self.loop = asyncio.get_running_loop()
        self.id = f"c{next(_ids)}"
        self.presence: dict[str, Any] = {}
        self.bucket = (30.0, time.monotonic())

    def peer(self) -> dict[str, Any]:
        u = self.user
        return {
            "connId": self.id,
            "userId": u.id if u else None,
            "name": u.name if u else "Guest",
            "color": u.color if u else "#B4AABF",
            "avatar": u.avatar_url if u else None,
            "role": self.role,
            **self.presence,
        }

    def allow(self, cost: float = 1.0, rate: float = 40.0, burst: float = 80.0) -> bool:
        tokens, last = self.bucket
        t = time.monotonic()
        tokens = min(burst, tokens + (t - last) * rate)
        if tokens < cost:
            self.bucket = (tokens, t)
            return False
        self.bucket = (tokens - cost, t)
        return True


class Hub:
    def __init__(self) -> None:
        self.rooms: dict[str, set[Conn]] = {}

    async def send(self, c: Conn, msg: dict[str, Any]) -> None:
        try:
            if asyncio.get_running_loop() is c.loop:
                await c.ws.send_json(msg)
            elif not c.loop.is_closed():
                await asyncio.wrap_future(asyncio.run_coroutine_threadsafe(c.ws.send_json(msg), c.loop))
        except Exception:  # noqa: BLE001 - a dead socket is cleaned up by its own loop
            pass

    async def broadcast(self, space_id: str, msg: dict[str, Any], skip: Optional[Conn] = None) -> None:
        conns = [c for c in self.rooms.get(space_id, ()) if c is not skip]
        await asyncio.gather(*(self.send(c, msg) for c in conns))

    def publish(self, space_id: str, msg: dict[str, Any]) -> None:
        """Broadcast from any thread (e.g. the file-processing worker or a REST handler)."""
        for connection in list(self.rooms.get(space_id, ())):
            if not connection.loop.is_closed():
                asyncio.run_coroutine_threadsafe(self.send(connection, msg), connection.loop)

    def kick_user(self, space_id: str, user_id: str) -> None:
        """Access was removed: close that person's sockets for this space."""
        for c in list(self.rooms.get(space_id, ())):
            if c.user and c.user.id == user_id and not c.loop.is_closed():
                asyncio.run_coroutine_threadsafe(self._kick(c), c.loop)

    async def _kick(self, c: Conn) -> None:
        await self.send(c, {"t": "kicked", "reason": "Your access to this board changed."})
        try:
            await c.ws.close(4403)
        except Exception:  # noqa: BLE001
            pass


hub = Hub()


def _origin_ok(ws: WebSocket) -> bool:
    origin = ws.headers.get("origin")
    if not origin:
        return True  # non-browser clients carry no ambient credentials worth protecting
    if origin.rstrip("/") == settings.public_url:
        return True
    return settings.dev and origin.startswith(("http://localhost", "http://127.0.0.1"))


def _connect(space_id: str, token: Optional[str], public: Optional[str]) -> tuple[Optional[Space], Optional[User], Optional[str]]:
    with SessionLocal() as db:
        space = db.get(Space, space_id)
        if not space:
            return None, None, None
        user = None
        if token:
            sess = db.scalar(select(UserSession).where(UserSession.token_hash == hash_token(token)))
            if sess and _aware(sess.expires_at) >= now():
                user = sess.user
                db.expunge(user)
        role = space_role(db, space, user)
        if role is None and public and space.public_token and public == space.public_token:
            role = "viewer"
        db.expunge(space)
        return space, user, role


def _apply(space_id: str, user: Optional[User], role: str, op: Any, cid: Any) -> dict[str, Any]:
    with SessionLocal() as db:
        space = db.get(Space, space_id)
        if not space:
            raise ops_mod.OpError("This board was deleted.", 410)
        u = db.get(User, user.id) if user else None
        role = space_role(db, space, u)
        if role is None:
            raise ops_mod.OpError("You no longer have access to this board.", 403)
        op = dict(op) if isinstance(op, dict) else op
        if isinstance(op, dict):
            op["cid"] = cid
        return ops_mod.apply(db, space, u, role, op)


def _drag(space_id: str, user: Optional[User], msg: dict[str, Any]) -> Optional[dict[str, Any]]:
    """Transient previews must obey the same hierarchy/access rules as durable moves."""
    if not user:
        return None
    with SessionLocal() as db:
        space = db.get(Space, space_id)
        u = db.get(User, user.id)
        role = space_role(db, space, u) if space else None
        if role is None:
            return None
        ctx = ops_mod.Ctx(db, space, u, role)
        try:
            n = ctx.node(msg.get("id"))
            parent = ctx.board(msg.get("parentId"))
            if n.parent_id is None or (n.type == "board" and ctx.is_inside(parent.id, n.id)):
                return None
            ctx.need_edit(n.parent_id)
            ctx.need_edit(parent.id)
            coords = [msg.get("x"), msg.get("y")]
            if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or abs(v) > 1e6 for v in coords):
                return None
            return {"id": n.id, "parentId": parent.id, "x": coords[0], "y": coords[1], "done": msg.get("done") is True}
        except ops_mod.OpError:
            return None


def _replay(space_id: str, since: int) -> Optional[list[dict[str, Any]]]:
    with SessionLocal() as db:
        space = db.get(Space, space_id)
        return ops_mod.replay(db, space, since) if space else None


def _presence(msg: dict[str, Any]) -> dict[str, Any]:
    def identifier(value):
        return isinstance(value, str) and 0 < len(value) <= 64

    def number(value):
        return not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value) and abs(value) <= 1e12

    out = {}
    if identifier(msg.get("focus")):
        out["focus"] = msg["focus"]
    cursor = msg.get("cursor")
    if cursor is None and "cursor" in msg:
        out["cursor"] = None
    elif isinstance(cursor, dict) and all(number(cursor.get(k)) for k in ("x", "y")):
        out["cursor"] = {k: cursor[k] for k in ("x", "y")}
        if identifier(cursor.get("b")):
            out["cursor"]["b"] = cursor["b"]
    view = msg.get("view")
    if isinstance(view, dict) and identifier(view.get("b")) and all(number(view.get(k)) for k in ("x", "y", "w", "h")) and view["w"] > 0 and view["h"] > 0:
        out["view"] = {k: view[k] for k in ("b", "x", "y", "w", "h")}
    path = msg.get("path")
    if isinstance(path, list) and len(path) <= 256 and all(identifier(v) for v in path):
        out["path"] = path
    return out


@router.websocket("/api/spaces/{space_id}/live")
async def live(ws: WebSocket, space_id: str, since: Optional[int] = None, public: Optional[str] = None):
    if not _origin_ok(ws):
        await ws.close(4403)
        return
    space, user, role = await run_in_threadpool(_connect, space_id, ws.cookies.get(COOKIE), public)
    if not space or not role:
        await ws.close(4404 if not space else 4403)
        return
    await ws.accept()
    conn = Conn(ws, user, role)
    room = hub.rooms.setdefault(space_id, set())
    await hub.send(conn, {"t": "hello", "connId": conn.id, "role": role, "seq": space.seq, "peers": [c.peer() for c in room]})
    room.add(conn)
    if since is not None:
        missed = await run_in_threadpool(_replay, space_id, since)
        if missed is None:
            await hub.send(conn, {"t": "resync"})
        else:
            for m in missed:
                await hub.send(conn, m)
    await hub.broadcast(space_id, {"t": "presence", "peer": conn.peer()}, skip=conn)
    try:
        while True:
            msg = await ws.receive_json()
            if not isinstance(msg, dict):
                continue
            t = msg.get("t")
            if t == "op":
                cid = msg.get("cid")
                if not conn.allow():
                    await hub.send(conn, {"t": "reject", "cid": cid, "error": "Too many changes at once — slow down a little.", "status": 429})
                    continue
                try:
                    result = await run_in_threadpool(_apply, space_id, conn.user, conn.role, msg.get("op"), cid)
                except ops_mod.OpError as e:
                    await hub.send(conn, {"t": "reject", "cid": cid, "error": str(e), "status": e.status})
                    continue
                except Exception:  # noqa: BLE001
                    log.exception("op failed")
                    await hub.send(conn, {"t": "reject", "cid": cid, "error": "Something went wrong saving that.", "status": 500})
                    continue
                await hub.broadcast(space_id, result)
            elif t == "presence":
                if not conn.allow(0.25):
                    continue
                conn.presence = _presence(msg)
                await hub.broadcast(space_id, {"t": "presence", "peer": conn.peer()}, skip=conn)
            elif t == "drag":
                if not conn.allow(0.25):
                    continue
                preview = await run_in_threadpool(_drag, space_id, conn.user, msg)
                if preview:
                    await hub.broadcast(space_id, {"t": "drag", "connId": conn.id, **preview}, skip=conn)
            elif t == "ping":
                await hub.send(conn, {"t": "pong"})
    except (WebSocketDisconnect, RuntimeError):
        pass
    except Exception:  # noqa: BLE001
        log.exception("live socket error")
    finally:
        room.discard(conn)
        if not room:
            hub.rooms.pop(space_id, None)
        await hub.broadcast(space_id, {"t": "leave", "connId": conn.id})
