"""Scoped MCP operations over the editor's existing transaction and scene model."""
import hashlib
import json
import math
import re
from collections import Counter

from fastapi import HTTPException
from sqlalchemy import select, func, cast, Text

from . import ops
from .live import hub
from .models import Node, Space, StoredFile, User, Workspace, WorkspaceMember, new_id
from .mcp_access import atomic, audit, authorize_board, clock, connection_for, within
from .mcp_models import GenerationTask, McpApproval, McpBatch, McpAudit
from .mcp_schema import CanvasBatch, Checkpoint
from .permissions import space_role


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def task_out(task):
    return {"id": task.id, "space_id": task.space_id, "board_id": task.board_id, "objective": task.objective,
            "state": task.state, "checkpoint": task.checkpoint, "updated": task.updated}


def paused_ancestor(db, connection, space_id, board_id):
    paused = set(db.scalars(select(GenerationTask.board_id).where(GenerationTask.user_id == connection.user_id, GenerationTask.space_id == space_id, GenerationTask.state == "paused")))
    seen = set()
    node = db.get(Node, board_id)
    while node and node.id not in seen:
        if node.id in paused:
            raise HTTPException(409, "Draft is paused; resume it before AI writes")
        seen.add(node.id)
        node = db.get(Node, node.parent_id) if node.parent_id else None


def task_get(db, connection, identifier, edit=False):
    task = db.get(GenerationTask, identifier)
    if not task or task.user_id != connection.user_id:
        raise HTTPException(404, "Task unavailable")
    authorize_board(db, connection, task.space_id, task.board_id, edit)
    return task


def get_board(connection_id, space_id, board_id, offset=0, limit=50):
    from .mcp_preview import enabled as previews_enabled
    if not 0 <= offset <= 100000 or not 1 <= limit <= 100:
        raise HTTPException(400, "Invalid pagination")
    with atomic() as db:
        connection = connection_for(db, connection_id)
        space, _, _ = authorize_board(db, connection, space_id, board_id)
        nodes = list(db.scalars(select(Node).where(Node.space_id == space.id, Node.parent_id == board_id).order_by(Node.id).offset(offset).limit(limit + 1)))
        output = [ops.node_out(n, ops.files_for(db, nodes)) for n in nodes[:limit]]
        for item in output:
            if len(item["content"].get("body", "")) > 4000:
                item["content"] = {**item["content"], "body": item["content"]["body"][:4000], "body_truncated": True}
        board = ops.node_out(db.get(Node, board_id))
        if board["parentId"] and not within(db, connection, space, board["parentId"]):
            board["parentId"] = None
        overlaps = []
        minimum_gap = None
        for i, a in enumerate(output):
            for b in output[i + 1:]:
                dx = max(a["x"] - b["x"] - b["w"], b["x"] - a["x"] - a["w"], 0)
                dy = max(a["y"] - b["y"] - b["h"], b["y"] - a["y"] - a["h"], 0)
                gap = math.hypot(dx, dy)
                minimum_gap = gap if minimum_gap is None else min(minimum_gap, gap)
                if min(a["x"] + a["w"], b["x"] + b["w"]) > max(a["x"], b["x"]) and min(a["y"] + a["h"], b["y"] + b["h"]) > max(a["y"], b["y"]):
                    if len(overlaps) < 50:
                        overlaps.append([a["id"], b["id"]])
        return {"board": board, "elements": output, "revision": space.seq, "next_offset": offset + limit if len(nodes) > limit else None,
                "overlaps_on_this_page": overlaps, "minimum_gap_on_this_page": minimum_gap,
                "bounds_on_this_page": {"x": min(n["x"] for n in output), "y": min(n["y"] for n in output),
                                        "right": max(n["x"] + n["w"] for n in output), "bottom": max(n["y"] + n["h"] for n in output)} if output else None,
                "editor_url": settings_url(f"/b/{space.id}?focus={board_id}"), "rendered_preview": previews_enabled(),
                "coordinate_system": "board-local x/y/w/h; z is elevation, not stacking; board content.frame is stable"}


def discover(connection_id, kind, space_id=None, query="", offset=0, limit=50):
    if not 0 <= offset <= 100000 or not 1 <= limit <= 100 or len(query) > 200:
        raise HTTPException(400, "Invalid query or pagination")
    with atomic() as db:
        connection = connection_for(db, connection_id)
        user = db.get(User, connection.user_id)
        result = []
        # Bound both the scan and the response; the cursor is a database offset, not a post-filter offset.
        if kind == "workspaces":
            grants = connection.grants
            if grants["mode"] == "boards":
                workspace_ids = set()
                for board in db.scalars(select(Node).where(Node.id.in_(grants["ids"]), Node.type == "board")):
                    space = db.get(Space, board.space_id)
                    if space and space_role(db, space, user):
                        workspace_ids.add(space.workspace_id)
                statement = select(Workspace).where(Workspace.id.in_(workspace_ids))
            else:
                statement = select(Workspace).join(WorkspaceMember).where(WorkspaceMember.user_id == user.id)
            rows = list(db.scalars(statement.order_by(Workspace.id).offset(offset).limit(limit)))
            for row in rows:
                if grants["mode"] in {"all", "boards"} or row.id in grants["ids"]:
                    result.append({"id": row.id, "name": row.name})
        else:
            statement = select(Node).join(Space, Node.space_id == Space.id).order_by(Node.id)
            if space_id:
                statement = statement.where(Node.space_id == space_id)
            if kind == "boards":
                statement = statement.where(Node.type == "board")
            if query:
                statement = statement.where(Node.search_text.contains(query.lower(), autoescape=True))
            rows = list(db.scalars(statement.offset(offset).limit(limit)))
            for node in rows:
                space = db.get(Space, node.space_id)
                if space_role(db, space, user) and within(db, connection, space, node.id):
                    result.append({"id": node.id, "space_id": space.id, "workspace_id": space.workspace_id, "type": node.type, "title": node.content.get("title", ""),
                                   "parent_id": node.parent_id if node.parent_id and within(db, connection, space, node.parent_id) else None, "revision": space.seq})
        return {"items": result, "next_offset": offset + limit if len(list(rows)) == limit else None}


def get_element(connection_id, space_id, element_id, text_offset=0, text_limit=8000):
    if not 0 <= text_offset <= 1000000 or not 1 <= text_limit <= 8000:
        raise HTTPException(400, "Invalid text pagination")
    with atomic() as db:
        connection = connection_for(db, connection_id)
        node = db.get(Node, element_id)
        if not node or node.space_id != space_id:
            raise HTTPException(404, "Element unavailable")
        space, _, _ = authorize_board(db, connection, space_id, node.id if node.type == "board" else node.parent_id)
        item = ops.node_out(node, ops.files_for(db, [node]))
        if node.parent_id and not within(db, connection, space, node.parent_id):
            item["parentId"] = None
        body = item["content"].get("body", "")
        item["content"] = {**item["content"], **({"body": body[text_offset:text_offset + text_limit]} if "body" in item["content"] else {})}
        return {"element": item, "revision": space.seq, "next_text_offset": text_offset + text_limit if len(body) > text_offset + text_limit else None}


def get_source_visual(connection_id, space_id, file_id, page=1):
    import io
    from PIL import Image
    from . import media, storage

    if isinstance(page, bool) or not isinstance(page, int) or not 1 <= page <= 100000:
        raise HTTPException(400, "Invalid source page")
    with atomic() as db:
        connection = connection_for(db, connection_id)
        file = db.get(StoredFile, file_id)
        if not file or file.space_id != space_id or file.size > 25 * 1024 * 1024:
            raise HTTPException(404, "Visual source unavailable or too large")
        linked = db.scalars(select(Node).where(Node.space_id == space_id, Node.content["fileId"].as_string() == file_id).limit(501))
        allowed = False
        for node in linked:
            try:
                authorize_board(db, connection, space_id, node.parent_id)
                allowed = True
                break
            except HTTPException:
                continue
        if not allowed:
            raise HTTPException(403, "Source outside connection scope")
        metadata = {"file_id": file.id, "filename": file.filename, "page": page, "verified_citation": False}
        if file.kind == "pdf":
            source = storage.path_for(f"{space_id}/{file.id}/original")
            kind = "pdf"
        elif file.mime in media.RASTER and page == 1 and (file.variants or {}).get("thumb_256"):
            variant = file.variants.get("thumb_1024") or file.variants["thumb_256"]
            source = storage.path_for(f"{space_id}/{file.id}/{variant}")
            kind = "image"
        else:
            raise HTTPException(415, "Visual inspection supports stored raster images and PDF pages")
    try:
        if kind == "pdf":
            image, count, _, _ = media.pdf_page(source, page, 1600)
            metadata["page_count"] = count
        else:
            with Image.open(source) as original:
                image = original.convert("RGB")
            metadata["page_count"] = 1
        try:
            image.thumbnail((1600, 1600))
            output = io.BytesIO()
            with image.convert("RGB") as rgb:
                rgb.save(output, "JPEG", quality=85)
            metadata.update(width=image.width, height=image.height, mime_type="image/jpeg")
            return {"metadata": metadata, "image": output.getvalue()}
        finally:
            image.close()
    except Exception:
        raise HTTPException(422, "Source visual could not be rendered; verify page and original availability") from None


def cached(db, connection, key, payload):
    digest = fingerprint(payload)
    previous = db.scalar(select(McpBatch).where(McpBatch.connection_id == connection.id, McpBatch.key == key))
    if previous and previous.digest != digest:
        raise HTTPException(409, "Idempotency key reused with different parameters")
    return digest, previous.result if previous else None


def create_moodboard(connection_id, workspace_id, title, key):
    from .seed import create_space
    if not 1 <= len(title) <= 120 or not 1 <= len(key) <= 120:
        raise HTTPException(400, "Invalid title or key")
    with atomic() as db:
        connection = connection_for(db, connection_id)
        member = db.get(WorkspaceMember, (workspace_id, connection.user_id))
        grant = connection.grants
        if not member or member.role == "viewer" or not grant["edit"] or grant["mode"] == "boards" or grant["mode"] == "workspaces" and workspace_id not in grant["ids"]:
            raise HTTPException(403, "Workspace creation not granted")
        digest, previous = cached(db, connection, key, {"kind": "moodboard", "workspace": workspace_id, "title": title})
        if previous:
            return previous
        space = create_space(db, db.get(Workspace, workspace_id), db.get(User, connection.user_id), title)
        result = {"space_id": space.id, "board_id": space.root_board_id, "revision": 0}
        db.add(McpBatch(connection_id=connection.id, key=key, digest=digest, result=result))
        audit(db, connection, "create_moodboard", result)
        return result


def prepare_ops(db, connection, space, operations):
    resolved, mapping, created = [], {}, {}
    for item in operations:
        if item.get("type") == "create":
            ref = item.get("ref")
            if not isinstance(ref, str) or not 1 <= len(ref) <= 80 or ref in mapping or ref.startswith("$"):
                raise HTTPException(400, "Create operations need unique client refs without a leading $")
            mapping[ref] = new_id()
    def identifier(value):
        if isinstance(value, str) and value.startswith("$"):
            if value[1:] not in mapping:
                raise HTTPException(400, "Unknown temporary reference")
            return mapping[value[1:]]
        return value
    def check_parent(identifier_):
        seen = set()
        while identifier_ in created:
            if identifier_ in seen:
                raise HTTPException(400, "Cyclic hierarchy")
            seen.add(identifier_)
            identifier_ = created[identifier_]
        authorize_board(db, connection, space.id, identifier_, True)
        paused_ancestor(db, connection, space.id, identifier_)
    for item in operations:
        if item.get("type") == "create":
            node = dict(item.get("node", {}))
            node["id"] = mapping[item["ref"]]
            node["parentId"] = identifier(node.get("parentId"))
            created[node["id"]] = node["parentId"]
    destructive, affected = False, []
    for item in operations:
        kind = item.get("type")
        supplied = item.get("node", {}) if kind == "create" else item.get("patch", {})
        if not isinstance(supplied, dict) or not isinstance(supplied.get("content", {}), dict):
            raise HTTPException(400, "Node, patch, and content must be objects")
        content = supplied.get("content", {})
        if "body" in content and (not isinstance(content["body"], str) or len(content["body"]) > ops.CONTENT_FIELDS["note"]["body"]):
            raise HTTPException(400, "Note body must be text, at most 100000 characters")
        if kind == "create":
            node = dict(item.get("node", {}))
            node["id"] = mapping[item["ref"]]
            node["parentId"] = identifier(node.get("parentId"))
            check_parent(node["parentId"])
            data = node
            resolved.append({"type": kind, "node": node})
        elif kind in {"update", "delete"}:
            node_id = identifier(item.get("id"))
            node = db.get(Node, node_id)
            if not node or node.space_id != space.id:
                raise HTTPException(404, "Update target unavailable; create first, edit in the next batch")
            check_parent(node.parent_id or node.id)
            paused_ancestor(db, connection, space.id, node.id)
            affected.append(node)
            if kind == "delete" and node.type == "board":
                frontier, count = [node.id], 0
                while frontier:
                    children = list(db.scalars(select(Node).where(Node.parent_id.in_(frontier)).limit(5001)))
                    frontier = []
                    count += len(children)
                    if count > 5000:
                        raise HTTPException(413, "Deletion subtree too large")
                    for child in children:
                        check_parent(child.parent_id)
                        paused_ancestor(db, connection, space.id, child.id)
                        if child.type == "board":
                            frontier.append(child.id)
            data = dict(item.get("patch", {})) if kind == "update" else {}
            if "parentId" in data:
                data["parentId"] = identifier(data["parentId"])
                check_parent(data["parentId"])
            old_body = node.content.get("body", "")
            new_body = data.get("content", {}).get("body", old_body)
            if kind == "update" and new_body != old_body and old_body:
                baseline = db.scalar(select(McpAudit).where(McpAudit.connection_id == connection.id, McpAudit.action == "edit_baseline", McpAudit.detail["node_id"].as_string() == node.id).limit(1))
                if not baseline:
                    baseline = McpAudit(user_id=connection.user_id, connection_id=connection.id, action="edit_baseline", at=clock(), detail={"node_id": node.id, "body": old_body})
                    db.add(baseline)
                    db.flush()
                original = baseline.detail["body"]
                words = Counter(re.findall(r"\w+|[^\w\s]", original))
                replacement = Counter(re.findall(r"\w+|[^\w\s]", new_body))
                retained = sum((words & replacement).values()) / max(1, sum(words.values()))
                destructive |= len(original) >= 500 and retained <= 0.5
            destructive |= kind == "delete"
            resolved.append({"type": kind, "id": node.id, **({"patch": data} if kind == "update" else {})})
        else:
            raise HTTPException(400, "Supported operations: create, update, delete")
        for name in ("x", "y", "z", "w", "h", "rank"):
            if name in data:
                value = data[name]
                low, high = (20, 20000) if name in {"w", "h"} else (0, 400) if name == "z" else (-1e6, 1e6)
                if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
                    raise HTTPException(400, f"Invalid {name}; coordinates are never silently clamped by MCP")
        content = data.get("content", {})
        references = content.get("references", [])
        if not isinstance(references, list):
            raise HTTPException(400, "references must be a list")
        for fid in [content.get("fileId"), *(r.get("asset_id") for r in references if isinstance(r, dict))]:
            if not fid:
                continue
            file = db.get(StoredFile, fid)
            if not file or file.space_id != space.id:
                raise HTTPException(403, "Asset outside space")
            if connection.grants["mode"] == "boards":
                linked = list(db.scalars(select(Node).where(Node.space_id == space.id, Node.content["fileId"].as_string() == fid).limit(500)))
                if not any(within(db, connection, space, n.id) for n in linked):
                    raise HTTPException(403, "Asset outside board scope; upload it into an authorized board first")
    return resolved, mapping, destructive or len(affected) > 20


def apply_batch(connection_id, value):
    batch = CanvasBatch.model_validate(value)
    payload = batch.model_dump()
    message = None
    with atomic() as db:
        connection = connection_for(db, connection_id)
        space = db.scalar(select(Space).where(Space.id == batch.space_id).with_for_update())
        if not space:
            raise HTTPException(404, "Space unavailable")
        user = db.get(User, connection.user_id)
        role = space_role(db, space, user)
        if not role or not connection.grants["edit"]:
            raise HTTPException(403, "Editing is not granted")
        digest, previous = cached(db, connection, batch.idempotency_key, payload)
        if previous:
            for board in previous.get("scope_boards", []):
                authorize_board(db, connection, space.id, board, True)
            return previous
        operations, mapping, destructive = prepare_ops(db, connection, space, batch.operations)
        if space.seq != batch.expected_revision:
            return {"error": "revision_conflict", "current_revision": space.seq, "expected_revision": batch.expected_revision}
        task = task_get(db, connection, batch.task_id, True) if batch.task_id else None
        if task:
            if task.space_id != space.id or task.state not in {"created", "generating"}:
                raise HTTPException(409, "Task is not accepting writes")
            # A task cannot mutate other branches even when its connection can.
            for operation in operations:
                target = operation.get("node", {}).get("parentId") or operation.get("id")
                while target in {n["node"]["id"] for n in operations if n["type"] == "create"}:
                    target = next(n["node"]["parentId"] for n in operations if n["type"] == "create" and n["node"]["id"] == target)
                node = db.get(Node, target)
                seen = set()
                while node and node.id != task.board_id and node.id not in seen:
                    seen.add(node.id)
                    node = db.get(Node, node.parent_id) if node.parent_id else None
                if not node or node.id != task.board_id:
                    raise HTTPException(403, "Operation outside task board")
        if destructive:
            policy = connection.grants["destructive"]
            if policy == "block":
                raise HTTPException(403, "Destructive operations blocked")
            elevated = policy == "elevated" and (
                connection.grants.get("elevation") == "persistent" or
                connection.grants.get("elevation") == "time" and (connection.grants.get("until") or 0) > clock() or
                connection.grants.get("elevation") == "task" and task and connection.grants.get("task_id") == task.id)
            approval = db.scalar(select(McpApproval).where(McpApproval.connection_id == connection.id, McpApproval.digest == digest, McpApproval.used == False, McpApproval.expires > clock()).with_for_update())
            if not elevated:
                if not approval or approval.expires <= clock():
                    approval = McpApproval(connection_id=connection.id, space_id=space.id, digest=digest, request=payload, expires=clock() + 600)
                    db.add(approval)
                    db.flush()
                if not approval.approved:
                    return {"error": "approval_required", "approval_id": approval.id, "approval_url": settings_url("/ai?approval=" + approval.id)}
                approval.used = True
            snapshot_size = db.scalar(select(func.sum(func.length(cast(Node.content, Text)))).where(Node.space_id == space.id)) or 0
            if snapshot_size > 8 * 1024 * 1024:
                raise HTTPException(413, "Destructive snapshot exceeds the 8 MiB recovery limit")
            snapshot = [ops.node_out(n) for n in db.scalars(select(Node).where(Node.space_id == space.id).limit(5001))]
            if len(snapshot) > 5000:
                raise HTTPException(413, "Space too large for safe destructive snapshot")
            audit(db, connection, "destructive_snapshot", {"space_id": space.id, "revision": space.seq, "nodes": snapshot})
        scope_boards = set()
        for operation in operations:
            if operation["type"] == "create":
                target = operation["node"]["parentId"]
                while target in mapping.values():
                    target = next(o["node"]["parentId"] for o in operations if o["type"] == "create" and o["node"]["id"] == target)
            else:
                old = db.get(Node, operation["id"])
                target = old.parent_id or old.id
            scope_boards.add(target)
        message = ops.apply(db, space, user, role, {"type": "batch", "ops": operations}, commit=False)
        result = {"revision": message["seq"], "ids": mapping, "changed_ids": [c.get("node", {}).get("id", c.get("id")) for c in message["changes"]], "scope_boards": sorted(scope_boards)}
        if task:
            task.state = "generating"
            task.updated = clock()
            task.checkpoint = {**task.checkpoint, "last_revision": result["revision"], "last_batch": batch.idempotency_key,
                               "created_ids": list(dict.fromkeys([*task.checkpoint.get("created_ids", []), *mapping.values()]))[-5000:]}
        db.add(McpBatch(connection_id=connection.id, key=batch.idempotency_key, digest=digest, result=result))
        audit(db, connection, "batch", {"space_id": space.id, "revision": result["revision"], "task_id": batch.task_id, "ids": result["changed_ids"]})
    hub.publish(batch.space_id, message)
    return result


def settings_url(path):
    from .config import settings
    return settings.public_url + path


TRANSITIONS = {"created": {"generating", "paused", "cancelled"}, "generating": {"paused", "interrupted", "completed", "failed", "cancelled"},
               "paused": {"generating", "cancelled"}, "interrupted": {"generating", "paused", "cancelled"}, "failed": {"generating", "cancelled"}, "completed": set(), "cancelled": set()}


def task_action(connection_id, action, space_id=None, board_id=None, task_id=None, objective="", checkpoint=None, expected_revision=None):
    with atomic() as db:
        connection = connection_for(db, connection_id)
        if action == "list":
            rows = db.scalars(select(GenerationTask).where(GenerationTask.user_id == connection.user_id).order_by(GenerationTask.updated.desc()).limit(100))
            output = []
            for task in rows:
                try:
                    authorize_board(db, connection, task.space_id, task.board_id)
                except HTTPException:
                    continue
                output.append(task_out(task))
            return {"tasks": output}
        if action == "create":
            if not 1 <= len(objective) <= 8000:
                raise HTTPException(400, "Objective required, at most 8000 characters")
            authorize_board(db, connection, space_id, board_id, True)
            digest, previous = cached(db, connection, "task-" + fingerprint([space_id, board_id, objective]), {"task": [space_id, board_id, objective]})
            if previous:
                return task_out(task_get(db, connection, previous["task_id"]))
            from sqlalchemy import func
            active = db.scalar(select(func.count()).select_from(GenerationTask).where(GenerationTask.user_id == connection.user_id, GenerationTask.state.not_in(["completed", "cancelled"])))
            if active >= 100:
                raise HTTPException(429, "Finish or cancel existing generation tasks first")
            task = GenerationTask(user_id=connection.user_id, connection_id=connection.id, space_id=space_id, board_id=board_id, objective=objective, updated=clock())
            db.add(task)
            db.flush()
            db.add(McpBatch(connection_id=connection.id, key="task-" + fingerprint([space_id, board_id, objective]), digest=digest, result={"task_id": task.id}))
        else:
            task = task_get(db, connection, task_id)
            if action != "get":
                space = db.scalar(select(Space).where(Space.id == task.space_id).with_for_update())
                db.refresh(task)
                authorize_board(db, connection, space.id, task.board_id, True)
                if action not in {"paused", "cancelled"} and expected_revision != space.seq:
                    raise HTTPException(409, "Inspect the current board revision before changing task state")
                if action == "checkpoint":
                    if len(json.dumps(checkpoint)) > 32000:
                        raise HTTPException(413, "Checkpoint too large")
                    task.checkpoint = {**task.checkpoint, **Checkpoint.model_validate(checkpoint or {}).model_dump(), "last_revision": space.seq}
                elif action in TRANSITIONS.get(task.state, set()):
                    task.state = action
                else:
                    raise HTTPException(409, "Invalid task transition")
                task.updated = clock()
                audit(db, connection, "task_" + action, {"task_id": task.id})
        output = task_out(task)
    if action != "get":
        hub.publish(output["space_id"], {"t": "generation", "task": output})
    return output


def upload_media(connection_id, space_id, board_id, filename, data_base64, key, expected_revision, x, y, w, h, task_id=None):
    import base64
    import io
    from starlette.datastructures import UploadFile
    from starlette.requests import Request
    from .files import store_upload
    from .storage import delete_dir
    if not isinstance(data_base64, str) or len(data_base64) > 2800000 or not 1 <= len(filename) <= 255:
        raise HTTPException(413, "Use direct upload for files larger than 2 MiB")
    try:
        content = base64.b64decode(data_base64, validate=True)
    except ValueError:
        raise HTTPException(400, "Invalid base64") from None
    if len(content) > 2 * 1024 * 1024 or not 1 <= len(key) <= 120:
        raise HTTPException(413, "Media or key too large")
    return upload_bytes(connection_id, space_id, board_id, filename, content, key, expected_revision, x, y, w, h, task_id)


def import_source(connection_id, space_id, board_id, file, key, expected_revision, x, y, w, h, task_id=None):
    from .mcp_download import download
    payload_key = {"provider_file": file.model_dump(), "space": space_id, "board": board_id, "key": key,
                   "revision": expected_revision, "geometry": [x, y, w, h], "task": task_id}
    if not 1 <= len(key) <= 120:
        raise HTTPException(400, "Invalid idempotency key")
    with atomic() as db:
        connection = connection_for(db, connection_id)
        authorize_board(db, connection, space_id, board_id, True)
        _, previous = cached(db, connection, key, payload_key)
        if previous:
            return previous
    payload = download(file.download_url)
    return upload_bytes(connection_id, space_id, board_id, file.file_name or "source-document", payload, key, expected_revision, x, y, w, h, task_id, request_payload=payload_key)


def upload_bytes(connection_id, space_id, board_id, filename, content, key, expected_revision, x, y, w, h, task_id=None, *, request_payload=None):
    import io
    from starlette.datastructures import UploadFile
    from starlette.requests import Request
    from .files import store_upload
    from .storage import delete_dir, used_bytes, path_for
    from .config import settings
    if not 1 <= len(key) <= 120 or len(content) > min(settings.max_upload_mb, 25) * 1024 * 1024:
        raise HTTPException(413, "File or idempotency key exceeds the transfer limit")
    for value, low, high in [(x, -1e6, 1e6), (y, -1e6, 1e6), (w, 20, 20000), (h, 20, 20000)]:
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
            raise HTTPException(400, "Invalid geometry")
    staged = None
    message = None
    try:
        with atomic() as db:
            connection = connection_for(db, connection_id)
            space = db.scalar(select(Space).where(Space.id == space_id).with_for_update())
            space, user, role = authorize_board(db, connection, space_id, board_id, True)
            digest, previous = cached(db, connection, key, request_payload or {"upload": hashlib.sha256(content).hexdigest(), "space": space_id, "board": board_id,
                                                           "filename": filename, "geometry": [x, y, w, h], "revision": expected_revision, "task": task_id})
            if previous:
                return previous
            paused_ancestor(db, connection, space.id, board_id)
            if used_bytes(space_id) + len(content) > settings.space_quota_mb * 1024 * 1024:
                raise HTTPException(413, "Space storage quota exceeded")
            if expected_revision != space.seq:
                raise HTTPException(409, "Revision conflict; inspect and retry")
            task = task_get(db, connection, task_id, True) if task_id else None
            if task:
                node = db.get(Node, board_id)
                while node and node.id != task.board_id:
                    node = db.get(Node, node.parent_id) if node.parent_id else None
                if task.space_id != space.id or not node or task.state not in {"created", "generating"}:
                    raise HTTPException(409, "Task is paused or upload is outside its board")
            request = Request({"type": "http", "method": "POST", "headers": [], "query_string": ("board=" + board_id).encode(), "client": ("127.0.0.1", 0)})
            staged = new_id()
            marker = path_for(f"{space_id}/{staged}/.mcp-staged")
            marker.parent.mkdir(parents=True, exist_ok=True)
            marker.touch()
            file = store_upload(space_id, request, UploadFile(io.BytesIO(content), filename=filename), user, db, commit=False, file_id=staged)
            stored = db.get(StoredFile, staged)
            if stored.kind not in {"image", "pdf", "document"}:
                raise HTTPException(415, "MCP transfer supports images, PDFs, and recognized documents; use the editor for other formats")
            node_id = new_id()
            message = ops.apply(db, space, user, role, {"type": "create", "node": {"id": node_id, "type": "image" if stored.kind == "image" else "file", "parentId": board_id,
                                                                                  "x": x, "y": y, "w": w, "h": h, "z": 20,
                                                                                  "content": {"fileId": staged, "title": filename, "alt": filename}}}, commit=False)
            result = {"file_id": staged, "element_id": node_id, "revision": space.seq}
            db.add(McpBatch(connection_id=connection.id, key=key, digest=digest, result=result))
            if task:
                task.state = "generating"
                task.updated = clock()
                task.checkpoint = {**task.checkpoint, "last_revision": space.seq, "created_ids": [*task.checkpoint.get("created_ids", []), node_id][-5000:]}
            audit(db, connection, "upload", result)
    except Exception:
        if staged:
            delete_dir(f"{space_id}/{staged}")
        raise
    if staged:
        try:
            path_for(f"{space_id}/{staged}/.mcp-staged").unlink(missing_ok=True)
        except OSError:
            pass  # Housekeeping recognizes committed file IDs and removes only their marker.
    hub.publish(space_id, message)
    return result
