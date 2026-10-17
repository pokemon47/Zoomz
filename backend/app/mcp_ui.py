"""Session-authenticated approvals, draft controls, source access, and recovery."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from .auth import require_user
from .models import Node, Space, StoredFile
from .mcp_models import GenerationTask, McpApproval, McpAudit, McpConnection
from .mcp_access import atomic, audit, clock
from .mcp_service import TRANSITIONS, task_out
from .permissions import require_space, role_at
from .storage import file_url
from .live import hub
from . import ops

router = APIRouter(prefix="/api/mcp")


@router.get("/tasks")
def tasks(space_id: str | None = None, user=Depends(require_user)):
    with atomic() as db:
        statement = select(GenerationTask).where(GenerationTask.user_id == user.id).order_by(GenerationTask.updated.desc()).limit(100)
        if space_id:
            require_space(db, space_id, user)
            statement = statement.where(GenerationTask.space_id == space_id)
        output = []
        for task in db.scalars(statement):
            try:
                require_space(db, task.space_id, user)
            except HTTPException:
                continue
            output.append(task_out(task))
        return {"tasks": output}


class TaskChange(BaseModel):
    state: str
    expected_revision: int = Field(ge=0)


@router.post("/tasks/{identifier}")
def change_task(identifier: str, body: TaskChange, user=Depends(require_user)):
    with atomic() as db:
        task = db.get(GenerationTask, identifier)
        if not task or task.user_id != user.id:
            raise HTTPException(404)
        space = db.scalar(select(Space).where(Space.id == task.space_id).with_for_update())
        db.refresh(task)
        _, role = require_space(db, task.space_id, user)
        if role_at(db, space, role, user, task.board_id) == "viewer":
            raise HTTPException(403)
        if (body.state not in {"paused", "cancelled"} and space.seq != body.expected_revision) or body.state not in TRANSITIONS.get(task.state, set()):
            raise HTTPException(409, "Inspect current revision and task state")
        task.state, task.updated = body.state, clock()
        audit(db, db.get(McpConnection, task.connection_id), "task_" + body.state, {"task_id": task.id, "via": "browser"})
        output = task_out(task)
    hub.publish(output["space_id"], {"t": "generation", "task": output})
    return output


@router.get("/approvals")
def approvals(user=Depends(require_user)):
    with atomic() as db:
        rows = db.scalars(select(McpApproval).join(McpConnection).where(McpConnection.user_id == user.id, McpApproval.used == False, McpApproval.expires > clock()).limit(100))
        return {"approvals": [{"id": a.id, "connection_id": a.connection_id, "space_id": a.space_id, "expires": a.expires, "approved": a.approved, "request": a.request} for a in rows]}


@router.post("/approvals/{identifier}")
def approve(identifier: str, user=Depends(require_user)):
    with atomic() as db:
        row = db.scalar(select(McpApproval).where(McpApproval.id == identifier).with_for_update())
        connection = db.get(McpConnection, row.connection_id) if row else None
        if not row or not connection or connection.user_id != user.id or connection.revoked or row.used or row.expires <= clock():
            raise HTTPException(404, "Approval expired or unavailable")
        require_space(db, row.space_id, user, "editor")
        row.approved = True
        audit(db, connection, "approve", {"approval_id": row.id, "digest": row.digest})
    return {"ok": True}


@router.get("/sources/{file_id}")
def source(file_id: str, page: int | None = None, user=Depends(require_user)):
    with atomic() as db:
        file = db.get(StoredFile, file_id)
        if not file:
            raise HTTPException(404, "Original source is unavailable")
        require_space(db, file.space_id, user)
        url = file_url(file.id, "original")
        if page and page > 0 and file.kind == "pdf":
            url += f"#page={page}"
        return {"url": url, "filename": file.filename}


@router.get("/snapshots")
def snapshots(user=Depends(require_user)):
    with atomic() as db:
        rows = db.scalars(select(McpAudit).where(McpAudit.user_id == user.id, McpAudit.action == "destructive_snapshot").order_by(McpAudit.at.desc()).limit(20))
        return {"snapshots": [{"id": a.id, "at": a.at, "space_id": a.detail["space_id"], "revision": a.detail["revision"]} for a in rows]}


@router.get("/snapshots/{identifier}")
def snapshot(identifier: str, user=Depends(require_user)):
    with atomic() as db:
        row = db.get(McpAudit, identifier)
        if not row or row.user_id != user.id or row.action != "destructive_snapshot":
            raise HTTPException(404)
        require_space(db, row.detail["space_id"], user)
        return row.detail


class Restore(BaseModel):
    expected_revision: int = Field(ge=0)
    confirm: str


@router.post("/snapshots/{identifier}/restore")
def restore_snapshot(identifier: str, body: Restore, user=Depends(require_user)):
    if body.confirm != "RESTORE SNAPSHOT":
        raise HTTPException(400, "Explicit restore confirmation required")
    messages = []
    with atomic() as db:
        snapshot = db.get(McpAudit, identifier)
        if not snapshot or snapshot.user_id != user.id or snapshot.action != "destructive_snapshot":
            raise HTTPException(404)
        space = db.scalar(select(Space).where(Space.id == snapshot.detail["space_id"]).with_for_update())
        _, role = require_space(db, space.id, user, "owner")
        if space.seq != body.expected_revision:
            raise HTTPException(409, "Inspect the current revision before restoring")
        current = list(db.scalars(select(Node).where(Node.space_id == space.id).limit(5001)))
        if len(current) > 5000:
            raise HTTPException(413, "Recovery space too large")
        db.add(McpAudit(user_id=user.id, connection_id=snapshot.connection_id, action="destructive_snapshot", at=clock(),
                        detail={"space_id": space.id, "revision": space.seq, "nodes": [ops.node_out(n) for n in current]}))
        operations = [{"type": "delete", "id": n.id} for n in current if n.parent_id == space.root_board_id]
        original = {n["id"]: n for n in snapshot.detail["nodes"]}
        root = original.pop(space.root_board_id, None)
        if not root:
            raise HTTPException(409, "Snapshot root no longer matches")
        operations.append({"type": "update", "id": root["id"], "patch": {"content": root["content"], "w": root["w"], "h": root["h"]}})
        ready = {root["id"]}
        while original:
            children = [n for n in original.values() if n["parentId"] in ready]
            if not children:
                raise HTTPException(409, "Snapshot hierarchy is invalid")
            for node in children:
                operations.append({"type": "create", "node": node})
                ready.add(node["id"])
                del original[node["id"]]
        for offset in range(0, len(operations), ops.MAX_BATCH):
            messages.append(ops.apply(db, space, user, role, {"type": "batch", "ops": operations[offset:offset + ops.MAX_BATCH]}, commit=False))
        audit(db, db.get(McpConnection, snapshot.connection_id), "restore_snapshot", {"snapshot_id": identifier, "space_id": space.id})
        revision = space.seq
    for message in messages:
        hub.publish(space.id, message)
    return {"revision": revision}
