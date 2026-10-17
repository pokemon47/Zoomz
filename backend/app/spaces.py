"""Spaces (moodboards), their contents, and sharing."""

from __future__ import annotations

from datetime import timedelta
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from . import mail
from . import ops as ops_mod
from .auth import EMAIL_RE, current_user_optional, require_user
from .config import settings
from .db import get_db
from .live import hub
from .models import RANK, ROLES, BoardOverride, Invite, Node, Space, SpaceMember, StoredFile, User, Workspace, WorkspaceMember, now
from .permissions import board_roles, require_space, space_role
from .ratelimit import limit
from .security import hash_token, new_token
from .seed import create_space
from .storage import delete_dir, file_url

router = APIRouter(prefix="/api", tags=["spaces"])
SHAREABLE = ("viewer", "editor")


def _aware(dt):
    from .auth import _aware as a

    return a(dt)


def space_summary(db: Session, s: Space, role: str) -> dict[str, Any]:
    thumbs = []
    for n in db.scalars(select(Node).where(Node.space_id == s.id, Node.type == "image").limit(4)):
        c = n.content or {}
        if c.get("src"):
            thumbs.append(c["src"])
        elif c.get("fileId"):
            f = db.get(StoredFile, c["fileId"])
            if f and "thumb_256" in (f.variants or {}):
                thumbs.append(file_url(f.id, "thumb_256"))
    members = db.scalar(select(SpaceMember.user_id).where(SpaceMember.space_id == s.id).limit(1))
    return {
        "id": s.id,
        "title": s.title,
        "role": role,
        "workspaceId": s.workspace_id,
        "updatedAt": _aware(s.updated_at).isoformat(),
        "thumbs": thumbs,
        "shared": bool(members) and db.query(SpaceMember).filter(SpaceMember.space_id == s.id).count() > 1,
    }


# ---------------------------------------------------------------- spaces


@router.get("/spaces")
def list_spaces(user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    ws_ids = list(db.scalars(select(WorkspaceMember.workspace_id).where(WorkspaceMember.user_id == user.id)))
    sp_ids = list(db.scalars(select(SpaceMember.space_id).where(SpaceMember.user_id == user.id)))
    spaces = db.scalars(select(Space).where(or_(Space.workspace_id.in_(ws_ids), Space.id.in_(sp_ids))).order_by(Space.updated_at.desc()))
    mine, shared = [], []
    for s in spaces:
        role = space_role(db, s, user)
        if not role:
            continue
        (mine if s.workspace_id in ws_ids else shared).append(space_summary(db, s, role))
    workspaces = [
        {"id": w.id, "name": w.name, "personal": w.personal, "role": db.get(WorkspaceMember, (w.id, user.id)).role}
        for w in db.scalars(select(Workspace).where(Workspace.id.in_(ws_ids)).order_by(Workspace.personal.desc(), Workspace.name))
    ]
    return {"mine": mine, "shared": shared, "workspaces": workspaces}


class NewSpace(BaseModel):
    title: str = "Untitled board"
    workspaceId: Optional[str] = None


@router.post("/spaces")
def new_space(body: NewSpace, request: Request, user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    limit(request, "new-space", 30, 10, key=user.id)
    ws_id = body.workspaceId or db.scalar(select(Workspace.id).where(Workspace.owner_id == user.id, Workspace.personal.is_(True)))
    wm = db.get(WorkspaceMember, (ws_id, user.id)) if ws_id else None
    if not wm or RANK[wm.role] < RANK["editor"]:
        raise HTTPException(403, "You can't add boards to that workspace.")
    ws = db.get(Workspace, ws_id)
    space = create_space(db, ws, user, (body.title or "Untitled board").strip()[:120])
    db.commit()
    return space_summary(db, space, "owner")


@router.get("/spaces/{space_id}/scene")
def scene(space_id: str, public: Optional[str] = None, user: Optional[User] = Depends(current_user_optional), db: Session = Depends(get_db)) -> dict:
    space, role = require_space(db, space_id, user, "viewer", public)
    nodes = list(db.scalars(select(Node).where(Node.space_id == space.id)))
    files = ops_mod.files_for(db, nodes)
    return {
        "space": {"id": space.id, "title": space.title, "role": role, "scenery": space.scenery, "workspaceId": space.workspace_id},
        "rootBoardId": space.root_board_id,
        "seq": space.seq,
        "nodes": [ops_mod.node_out(n, files) for n in nodes],
        "boardRoles": board_roles(db, space, role, user, nodes),
    }


class SpacePatch(BaseModel):
    title: Optional[str] = None
    scenery: Optional[str] = None


@router.patch("/spaces/{space_id}")
def patch_space(space_id: str, body: SpacePatch, user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    space, role = require_space(db, space_id, user, "editor")
    if body.title is not None:
        space.title = body.title.strip()[:120] or space.title
        root = db.get(Node, space.root_board_id)
        if root:
            root.content = {**(root.content or {}), "title": space.title}
            root.search_text = ops_mod.search_text("board", root.content)
    if body.scenery is not None:
        space.scenery = body.scenery[:20]
    space.updated_at = now()
    db.commit()
    hub.publish(space.id, {"t": "space", "title": space.title, "scenery": space.scenery})
    return space_summary(db, space, role)


@router.delete("/spaces/{space_id}")
def delete_space(space_id: str, user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    space, _ = require_space(db, space_id, user, "owner")
    sid = space.id
    db.delete(space)
    db.commit()
    delete_dir(sid)
    hub.publish(sid, {"t": "kicked", "reason": "This board was deleted."})
    return {"ok": True}


class OpIn(BaseModel):
    op: dict[str, Any]


@router.post("/spaces/{space_id}/ops")
def post_op(space_id: str, body: OpIn, user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    """Same edits as the live socket, for scripts and as a fallback."""
    space, role = require_space(db, space_id, user, "viewer")
    try:
        msg = ops_mod.apply(db, space, user, role, body.op)
    except ops_mod.OpError as e:
        raise HTTPException(e.status, str(e))
    hub.publish(space.id, msg)
    return msg


# ---------------------------------------------------------------- sharing


def _member_out(u: User, role: str, via: str) -> dict[str, Any]:
    return {"userId": u.id, "email": u.email, "name": u.name, "color": u.color, "avatar": u.avatar_url, "role": role, "via": via}


@router.get("/spaces/{space_id}/sharing")
def sharing(space_id: str, user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    space, role = require_space(db, space_id, user, "viewer")
    members: dict[str, dict[str, Any]] = {}
    for wm in db.scalars(select(WorkspaceMember).where(WorkspaceMember.workspace_id == space.workspace_id)):
        u = db.get(User, wm.user_id)
        if u:
            members[u.id] = _member_out(u, wm.role, "workspace")
    for sm in db.scalars(select(SpaceMember).where(SpaceMember.space_id == space.id)):
        u = db.get(User, sm.user_id)
        if u and (u.id not in members or RANK[sm.role] > RANK[members[u.id]["role"]]):
            members[u.id] = _member_out(u, sm.role, "space")
    out: dict[str, Any] = {"role": role, "members": sorted(members.values(), key=lambda m: (-RANK[m["role"]], m["name"].lower()))}
    if role == "owner":
        out["invites"] = [
            {"id": i.id, "email": i.email, "role": i.role, "expiresAt": _aware(i.expires_at).isoformat()}
            for i in db.scalars(select(Invite).where(Invite.space_id == space.id, Invite.accepted_at.is_(None)))
            if _aware(i.expires_at) > now()
        ]
        out["joinLink"] = (
            {"url": f"{settings.public_url}/join/{space.join_token}", "role": space.join_role, "expiresAt": _aware(space.join_expires_at).isoformat() if space.join_expires_at else None}
            if space.join_token
            else None
        )
        out["publicLink"] = {"url": f"{settings.public_url}/p/{space.public_token}"} if space.public_token else None
        board_ids = list(db.scalars(select(Node.id).where(Node.space_id == space.id, Node.type == "board")))
        out["overrides"] = [
            {"boardId": o.board_id, "userId": o.user_id, "role": o.role}
            for o in db.scalars(select(BoardOverride).where(BoardOverride.board_id.in_(board_ids)))
        ]
    return out


class InviteIn(BaseModel):
    email: str
    role: str = "editor"


@router.post("/spaces/{space_id}/invites")
def invite(space_id: str, body: InviteIn, request: Request, user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    space, _ = require_space(db, space_id, user, "owner")
    email = body.email.strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(422, "That doesn't look like an email address.")
    if body.role not in SHAREABLE:
        raise HTTPException(422, "Invite people as an editor or a viewer.")
    limit(request, "invite", 30, 15, key=user.id)
    token = new_token()
    inv = Invite(space_id=space.id, email=email, role=body.role, token_hash=hash_token(token), invited_by=user.id, expires_at=now() + timedelta(days=14))
    db.add(inv)
    link = f"{settings.public_url}/invite/{token}"
    mail.send(
        email,
        f"{user.name} shared “{space.title}” with you",
        f"{user.name} ({user.email}) invited you to {'edit' if body.role == 'editor' else 'view'} the board “{space.title}” on Zoomz.",
        ("Open the board", link),
    )
    db.commit()
    out = {"id": inv.id, "email": email, "role": inv.role}
    if settings.dev and not settings.smtp_host:
        out["devLink"] = link
    return out


@router.delete("/spaces/{space_id}/invites/{invite_id}")
def revoke_invite(space_id: str, invite_id: str, user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    space, _ = require_space(db, space_id, user, "owner")
    inv = db.get(Invite, invite_id)
    if inv and inv.space_id == space.id:
        db.delete(inv)
        db.commit()
    return {"ok": True}


class RoleIn(BaseModel):
    role: str


@router.put("/spaces/{space_id}/members/{user_id}")
def set_member(space_id: str, user_id: str, body: RoleIn, user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    space, _ = require_space(db, space_id, user, "owner")
    if body.role not in ROLES:
        raise HTTPException(422, "Unknown role.")
    if user_id == user.id and body.role != "owner" and _owner_count(db, space) <= 1:
        raise HTTPException(409, "A board needs at least one owner.")
    sm = db.get(SpaceMember, (space.id, user_id))
    if sm:
        sm.role = body.role
    else:
        if not db.get(User, user_id):
            raise HTTPException(404, "No such person.")
        db.add(SpaceMember(space_id=space.id, user_id=user_id, role=body.role))
    db.commit()
    hub.kick_user(space.id, user_id)  # reconnects with the new role
    return {"ok": True}


@router.delete("/spaces/{space_id}/members/{user_id}")
def remove_member(space_id: str, user_id: str, user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    space, role = require_space(db, space_id, user, "viewer")
    if user_id != user.id and role != "owner":
        raise HTTPException(403, "Only owners can remove people.")
    sm = db.get(SpaceMember, (space.id, user_id))
    if sm:
        if sm.role == "owner" and _owner_count(db, space) <= 1:
            raise HTTPException(409, "A board needs at least one owner. Make someone else an owner first.")
        db.delete(sm)
        db.commit()
    hub.kick_user(space.id, user_id)
    return {"ok": True}


def _owner_count(db: Session, space: Space) -> int:
    return db.query(SpaceMember).filter(SpaceMember.space_id == space.id, SpaceMember.role == "owner").count() + (
        db.query(WorkspaceMember).filter(WorkspaceMember.workspace_id == space.workspace_id, WorkspaceMember.role == "owner").count()
    )


class JoinLinkIn(BaseModel):
    enabled: bool
    role: str = "viewer"
    expiresInDays: Optional[int] = None


@router.put("/spaces/{space_id}/join-link")
def set_join_link(space_id: str, body: JoinLinkIn, user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    space, _ = require_space(db, space_id, user, "owner")
    if not body.enabled:
        space.join_token = space.join_role = space.join_expires_at = None
    else:
        if body.role not in SHAREABLE:
            raise HTTPException(422, "Links can grant editor or viewer access.")
        space.join_token = space.join_token or new_token()
        space.join_role = body.role
        space.join_expires_at = now() + timedelta(days=body.expiresInDays) if body.expiresInDays else None
    db.commit()
    return sharing(space_id, user, db)


class PublicLinkIn(BaseModel):
    enabled: bool


@router.put("/spaces/{space_id}/public-link")
def set_public_link(space_id: str, body: PublicLinkIn, user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    space, _ = require_space(db, space_id, user, "owner")
    space.public_token = (space.public_token or new_token()) if body.enabled else None
    db.commit()
    return sharing(space_id, user, db)


class OverrideIn(BaseModel):
    boardId: str
    userId: str
    role: Optional[str] = None


@router.put("/spaces/{space_id}/overrides")
def set_override(space_id: str, body: OverrideIn, user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    space, _ = require_space(db, space_id, user, "owner")
    board = db.get(Node, body.boardId)
    if not board or board.space_id != space.id or board.type != "board":
        raise HTTPException(404, "No such board.")
    target = db.get(User, body.userId)
    if not target or space_role(db, space, target) is None:
        raise HTTPException(404, "That person isn't on this board.")
    if space_role(db, space, target) == "owner":
        raise HTTPException(409, "Owners can do everything everywhere.")
    existing = db.get(BoardOverride, (board.id, target.id))
    if body.role is None:
        if existing:
            db.delete(existing)
    else:
        if body.role not in SHAREABLE:
            raise HTTPException(422, "Use editor or viewer.")
        if existing:
            existing.role = body.role
        else:
            db.add(BoardOverride(board_id=board.id, user_id=target.id, role=body.role))
    db.commit()
    hub.kick_user(space.id, target.id)
    return {"ok": True}


# ---------------------------------------------------------------- accepting invites and links


def _invite(db: Session, token: str) -> Invite:
    inv = db.scalar(select(Invite).where(Invite.token_hash == hash_token(token)))
    if not inv or _aware(inv.expires_at) < now():
        raise HTTPException(404, "This invite has expired or was withdrawn. Ask for a new one.")
    return inv


@router.get("/invites/{token}")
def invite_info(token: str, db: Session = Depends(get_db)) -> dict:
    inv = _invite(db, token)
    space = db.get(Space, inv.space_id)
    by = db.get(User, inv.invited_by) if inv.invited_by else None
    return {"spaceId": space.id, "title": space.title, "role": inv.role, "email": inv.email, "invitedBy": by.name if by else None, "accepted": bool(inv.accepted_at)}


@router.post("/invites/{token}/accept")
def accept_invite(token: str, user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    inv = _invite(db, token)
    if inv.email != user.email:
        raise HTTPException(403, f"This invite is for {inv.email}. Sign in with that address to accept it.")
    _grant(db, inv.space_id, user.id, inv.role)
    inv.accepted_at = inv.accepted_at or now()
    db.commit()
    return {"spaceId": inv.space_id}


def _grant(db: Session, space_id: str, user_id: str, role: str) -> None:
    sm = db.get(SpaceMember, (space_id, user_id))
    if sm:
        if RANK[role] > RANK[sm.role]:
            sm.role = role
    else:
        db.add(SpaceMember(space_id=space_id, user_id=user_id, role=role))


def _join_space(db: Session, token: str) -> Space:
    space = db.scalar(select(Space).where(Space.join_token == token))
    if not space or (space.join_expires_at and _aware(space.join_expires_at) < now()):
        raise HTTPException(404, "This link has expired or was turned off.")
    return space


@router.get("/join/{token}")
def join_info(token: str, db: Session = Depends(get_db)) -> dict:
    space = _join_space(db, token)
    return {"spaceId": space.id, "title": space.title, "role": space.join_role}


@router.post("/join/{token}")
def join(token: str, user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    space = _join_space(db, token)
    _grant(db, space.id, user.id, space.join_role or "viewer")
    db.commit()
    return {"spaceId": space.id}


@router.get("/public/{token}")
def public_info(token: str, db: Session = Depends(get_db)) -> dict:
    space = db.scalar(select(Space).where(Space.public_token == token))
    if not space:
        raise HTTPException(404, "This public link was turned off.")
    return {"spaceId": space.id, "title": space.title}
