"""Starter content: every new account gets its own copy of the demo moodboard."""

from __future__ import annotations

import json
import uuid
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

from sqlalchemy.orm import Session

from .models import Node, Space, SpaceMember, User, Workspace
from .ops import DEFAULT_FRAME, search_text

FIXTURE = Path(__file__).resolve().parent / "data" / "demo-board.json"
CONTENT_PAD = 40  # matches the frontend's breathing room around a board's content


@lru_cache(maxsize=1)
def demo_nodes() -> list[dict[str, Any]]:
    return json.loads(FIXTURE.read_text())["nodes"]


def frame_for(children: list[dict[str, Any]]) -> dict[str, float]:
    """A board's content window: the bounds of its children plus padding."""
    if not children:
        return dict(DEFAULT_FRAME)
    x0 = min(c["x"] for c in children)
    y0 = min(c["y"] for c in children)
    x1 = max(c["x"] + c["w"] for c in children)
    y1 = max(c["y"] + c["h"] for c in children)
    return {"x": x0 - CONTENT_PAD, "y": y0 - CONTENT_PAD, "w": x1 - x0 + CONTENT_PAD * 2, "h": y1 - y0 + CONTENT_PAD * 2}


def create_space(db: Session, ws: Workspace, user: Optional[User], title: str, template: Optional[list[dict[str, Any]]] = None) -> Space:
    """A new space with a root board; optionally filled from a template node list."""
    prefix = uuid.uuid4().hex[:10]
    nodes = template or [{"id": "root", "type": "board", "parentId": None, "x": 0, "y": 0, "z": 0, "w": 360, "h": 330, "content": {"title": title}}]
    ids = {n["id"]: f"{prefix}-{n['id']}"[:64] for n in nodes}
    root = next(n for n in nodes if n["parentId"] is None)
    space = Space(workspace_id=ws.id, title=title, root_board_id=ids[root["id"]], created_by=user.id if user else None)
    db.add(space)
    db.flush()
    if user:
        db.add(SpaceMember(space_id=space.id, user_id=user.id, role="owner"))
    children: dict[str, list[dict[str, Any]]] = {}
    for n in nodes:
        if n["parentId"]:
            children.setdefault(n["parentId"], []).append(n)
    # Parents before children so foreign keys are satisfied as we insert.
    order, queue = [], [root]
    while queue:
        n = queue.pop(0)
        order.append(n)
        queue += children.get(n["id"], [])
    for n in order:
        content = dict(n["content"])
        if n["type"] == "board":
            content.setdefault("frame", frame_for(children.get(n["id"], [])) if children.get(n["id"]) else dict(DEFAULT_FRAME))
            if n["parentId"] is None:
                content["title"] = title
        db.add(
            Node(
                id=ids[n["id"]],
                space_id=space.id,
                parent_id=ids[n["parentId"]] if n["parentId"] else None,
                type=n["type"],
                x=n["x"],
                y=n["y"],
                z=n.get("z", 0),
                w=n["w"],
                h=n["h"],
                content=content,
                search_text=search_text(n["type"], content),
                created_by=user.id if user else None,
            )
        )
        db.flush()
    return space


def create_starter_space(db: Session, ws: Workspace, user: User) -> Space:
    return create_space(db, ws, user, "Summer Light", demo_nodes())
