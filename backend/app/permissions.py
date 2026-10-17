"""Who may do what.

Roles: owner > editor > viewer. Your role in a space is the higher of your workspace
role and your space role. Inside the space, a board override replaces that role for one
board and everything below it (nearest override wins); owners are never overridden.
"""

from __future__ import annotations

from typing import Iterable, Optional

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import RANK, BoardOverride, Node, Space, SpaceMember, User, WorkspaceMember


def higher(a: Optional[str], b: Optional[str]) -> Optional[str]:
    if a is None:
        return b
    if b is None:
        return a
    return a if RANK[a] >= RANK[b] else b


def space_role(db: Session, space: Space, user: Optional[User]) -> Optional[str]:
    if not user:
        return None
    sm = db.get(SpaceMember, (space.id, user.id))
    wm = db.get(WorkspaceMember, (space.workspace_id, user.id))
    return higher(sm.role if sm else None, wm.role if wm else None)


def require_space(db: Session, space_id: str, user: Optional[User], need: str = "viewer", public_token: Optional[str] = None) -> tuple[Space, str]:
    space = db.get(Space, space_id)
    if not space:
        raise HTTPException(404, "That board doesn't exist (or was deleted).")
    role = space_role(db, space, user)
    if role is None and public_token and space.public_token and public_token == space.public_token:
        role = "viewer"
    if role is None:
        raise HTTPException(404 if not user else 403, "You don't have access to this board.")
    if RANK[role] < RANK[need]:
        raise HTTPException(403, f"You need {need} access to do that.")
    return space, role


def board_roles(db: Session, space: Space, base_role: str, user: Optional[User], nodes: Iterable[Node]) -> dict[str, str]:
    """Effective role at every board in the space (one pass, parents before children)."""
    boards = {n.id: n for n in nodes if n.type == "board"}
    overrides: dict[str, str] = {}
    if user and base_role != "owner":
        for o in db.scalars(select(BoardOverride).where(BoardOverride.user_id == user.id, BoardOverride.board_id.in_(list(boards)))):
            overrides[o.board_id] = o.role
    out: dict[str, str] = {}

    def resolve(bid: str) -> str:
        if bid in out:
            return out[bid]
        b = boards.get(bid)
        if bid in overrides:
            role = overrides[bid]
        elif b is None or b.parent_id is None or b.parent_id not in boards:
            role = base_role
        else:
            role = resolve(b.parent_id)
        out[bid] = role
        return role

    for bid in boards:
        resolve(bid)
    return out


def role_at(db: Session, space: Space, base_role: str, user: Optional[User], board_id: Optional[str]) -> str:
    """Effective role inside one board (walks up to the nearest override)."""
    if base_role == "owner" or not user or board_id is None:
        return base_role
    seen = 0
    bid: Optional[str] = board_id
    while bid and seen < 64:
        o = db.get(BoardOverride, (bid, user.id))
        if o:
            return o.role
        node = db.get(Node, bid)
        bid = node.parent_id if node else None
        seen += 1
    return base_role


def can_edit(role: str) -> bool:
    return RANK[role] >= RANK["editor"]
