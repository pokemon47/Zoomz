"""Your profile, team workspaces, and your data (export / delete)."""

from __future__ import annotations

import io
import json
import re
import zipfile
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import mail
from .auth import COOKIE, EMAIL_RE, require_user
from .config import settings
from .db import get_db
from .models import RANK, Node, Space, SpaceMember, StoredFile, User, Workspace, WorkspaceMember
from .ratelimit import limit
from .storage import delete_dir, path_for

router = APIRouter(prefix="/api", tags=["account"])
HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")


def me_out(u: User) -> dict[str, Any]:
    return {"id": u.id, "email": u.email, "name": u.name, "color": u.color, "avatar": u.avatar_url}


@router.get("/me")
def me(user: User = Depends(require_user)) -> dict:
    return me_out(user)


class MePatch(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None


@router.patch("/me")
def patch_me(body: MePatch, user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    u = db.merge(user)
    if body.name is not None:
        name = body.name.strip()[:80]
        if not name:
            raise HTTPException(422, "Your name can't be empty.")
        u.name = name
    if body.color is not None:
        if not HEX.match(body.color):
            raise HTTPException(422, "Pick a colour like #FF8E72.")
        u.color = body.color
    db.commit()
    return me_out(u)


# ---------------------------------------------------------------- workspaces


class NewWorkspace(BaseModel):
    name: str


@router.post("/workspaces")
def new_workspace(body: NewWorkspace, request: Request, user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    limit(request, "workspace", 10, 5, key=user.id)
    name = body.name.strip()[:80] or "Team"
    ws = Workspace(name=name, owner_id=user.id, personal=False)
    db.add(ws)
    db.flush()
    db.add(WorkspaceMember(workspace_id=ws.id, user_id=user.id, role="owner"))
    db.commit()
    return {"id": ws.id, "name": ws.name, "personal": False, "role": "owner"}


def _ws(db: Session, ws_id: str, user: User, need: str) -> Workspace:
    ws = db.get(Workspace, ws_id)
    wm = db.get(WorkspaceMember, (ws_id, user.id)) if ws else None
    if not ws or not wm:
        raise HTTPException(404, "No such workspace.")
    if RANK[wm.role] < RANK[need]:
        raise HTTPException(403, f"You need {need} access to do that.")
    return ws


@router.get("/workspaces/{ws_id}/members")
def ws_members(ws_id: str, user: User = Depends(require_user), db: Session = Depends(get_db)) -> list:
    _ws(db, ws_id, user, "viewer")
    out = []
    for wm in db.scalars(select(WorkspaceMember).where(WorkspaceMember.workspace_id == ws_id)):
        u = db.get(User, wm.user_id)
        if u:
            out.append({"userId": u.id, "email": u.email, "name": u.name, "color": u.color, "role": wm.role})
    return out


class WsMemberIn(BaseModel):
    email: str
    role: str = "editor"


@router.post("/workspaces/{ws_id}/members")
def add_ws_member(ws_id: str, body: WsMemberIn, request: Request, user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    ws = _ws(db, ws_id, user, "owner")
    if ws.personal:
        raise HTTPException(409, "Your personal workspace is just for you. Create a team workspace to work with others.")
    email = body.email.strip().lower()
    if not EMAIL_RE.match(email) or body.role not in ("viewer", "editor", "owner"):
        raise HTTPException(422, "Use a valid email and a role of viewer, editor or owner.")
    limit(request, "ws-invite", 30, 15, key=user.id)
    from .auth import get_or_create_user

    target, created = get_or_create_user(db, email)
    wm = db.get(WorkspaceMember, (ws.id, target.id))
    if wm:
        wm.role = body.role
    else:
        db.add(WorkspaceMember(workspace_id=ws.id, user_id=target.id, role=body.role))
    db.commit()
    mail.send(
        email,
        f"{user.name} added you to {ws.name} on Zoomz",
        f"{user.name} ({user.email}) added you to the workspace “{ws.name}”. Sign in with this email address to see its boards.",
        ("Open Zoomz", f"{settings.public_url}/login"),
    )
    return {"userId": target.id, "email": target.email, "name": target.name, "color": target.color, "role": body.role}


@router.delete("/workspaces/{ws_id}/members/{user_id}")
def remove_ws_member(ws_id: str, user_id: str, user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    ws = _ws(db, ws_id, user, "viewer" if user_id == user.id else "owner")
    if user_id == ws.owner_id:
        raise HTTPException(409, "The workspace's creator can't be removed.")
    wm = db.get(WorkspaceMember, (ws.id, user_id))
    if wm:
        db.delete(wm)
        db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- your data


@router.get("/me/export")
def export(user: User = Depends(require_user), db: Session = Depends(get_db)):
    """Everything we hold about you, plus the boards you own (with their files), as a zip."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("profile.json", json.dumps({**me_out(user), "createdAt": user.created_at.isoformat()}, indent=2))
        memberships = [{"spaceId": m.space_id, "role": m.role} for m in db.scalars(select(SpaceMember).where(SpaceMember.user_id == user.id))]
        z.writestr("memberships.json", json.dumps(memberships, indent=2))
        owned_ws = [w.id for w in db.scalars(select(Workspace).where(Workspace.owner_id == user.id))]
        for s in db.scalars(select(Space).where(Space.workspace_id.in_(owned_ws))):
            nodes = [
                {"id": n.id, "parentId": n.parent_id, "type": n.type, "x": n.x, "y": n.y, "z": n.z, "w": n.w, "h": n.h, "content": n.content}
                for n in db.scalars(select(Node).where(Node.space_id == s.id))
            ]
            folder = f"boards/{_safe(s.title)}-{s.id[:6]}"
            z.writestr(f"{folder}/board.json", json.dumps({"title": s.title, "nodes": nodes}, indent=2))
            for f in db.scalars(select(StoredFile).where(StoredFile.space_id == s.id)):
                p = path_for(f"{s.id}/{f.id}/original")
                if p.exists():
                    z.write(p, f"{folder}/files/{f.id[:8]}-{_safe(f.filename)}")
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/zip", headers={"Content-Disposition": 'attachment; filename="zoomz-export.zip"'})


def _safe(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9._ -]", "_", name)[:80] or "untitled"


class DeleteMe(BaseModel):
    confirmEmail: str


@router.delete("/me")
def delete_me(body: DeleteMe, response: Response, user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    """Delete your account, the workspaces you created (and their boards and files)."""
    if body.confirmEmail.strip().lower() != user.email:
        raise HTTPException(422, "Type your email address to confirm.")
    owned_ws = [w.id for w in db.scalars(select(Workspace).where(Workspace.owner_id == user.id))]
    space_ids = list(db.scalars(select(Space.id).where(Space.workspace_id.in_(owned_ws))))
    db.delete(db.merge(user))
    db.commit()  # cascades: sessions, memberships, owned workspaces → their spaces → nodes, files
    for sid in space_ids:
        delete_dir(sid)
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}
