"""OAuth boundary and cookie-authenticated delegation management."""
import base64
import hashlib
import re
import time
from contextlib import contextmanager
from typing import Literal
from urllib.parse import urlencode, urlsplit, parse_qsl, urlunsplit

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, text

from .auth import require_user
from .config import settings
from .db import SessionLocal
from .models import Node, User, WorkspaceMember, new_id
from .mcp_models import McpAudit, McpClient, McpConnection, McpCredential, McpPending
from .permissions import require_space, role_at
from .ratelimit import limit
from .security import hash_token, new_token

router = APIRouter()
SCOPES = {"zoomz:read", "zoomz:edit", "offline_access"}


def clock():
    return int(time.time())


def resource_url():
    return settings.public_url + "/mcp"


@contextmanager
def atomic():
    with SessionLocal() as db:
        if db.bind.dialect.name == "sqlite":
            db.execute(text("BEGIN IMMEDIATE"))
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise


def audit(db, connection, action, detail=None):
    db.add(McpAudit(user_id=connection.user_id, connection_id=connection.id, action=action, at=clock(), detail=detail or {}))


class Grants(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["workspaces", "boards", "all"] = "workspaces"
    ids: list[str] = Field(default_factory=list, max_length=100)
    edit: bool = False
    destructive: Literal["approve", "block", "elevated"] = "approve"
    elevation: Literal["task", "time", "persistent"] | None = None
    task_id: str | None = None
    until: int | None = None


def validate_grants(db, user, grants):
    if grants.mode != "all" and not grants.ids:
        raise HTTPException(400, "Choose at least one workspace or board")
    for identifier in grants.ids:
        if grants.mode == "workspaces":
            if not db.get(WorkspaceMember, (identifier, user.id)):
                raise HTTPException(403, "Workspace unavailable")
        elif grants.mode == "boards":
            board = db.get(Node, identifier)
            if not board or board.type != "board":
                raise HTTPException(403, "Board unavailable")
            require_space(db, board.space_id, user)
    if grants.destructive == "elevated":
        if grants.elevation == "time" and (not grants.until or not clock() < grants.until <= clock() + 86400):
            raise HTTPException(400, "Elevation must expire within 24 hours")
        if grants.elevation == "task":
            from .mcp_models import GenerationTask
            task = db.get(GenerationTask, grants.task_id)
            if not task or task.user_id != user.id:
                raise HTTPException(400, "Select your existing task")
        if grants.elevation is None:
            raise HTTPException(400, "Choose an elevation duration")
    return grants.model_dump()


def connection_for(db, identifier):
    connection = db.scalar(select(McpConnection).where(McpConnection.id == identifier).with_for_update())
    if not connection or connection.revoked or not db.get(User, connection.user_id):
        raise HTTPException(401, "Connection revoked or unavailable")
    return connection


def within(db, connection, space, board_id):
    grants = Grants.model_validate(connection.grants)
    if grants.mode == "all":
        return True
    if grants.mode == "workspaces":
        return space.workspace_id in grants.ids
    seen = set()
    node = db.get(Node, board_id) if board_id else None
    while node and node.space_id == space.id and node.id not in seen:
        if node.id in grants.ids:
            return True
        seen.add(node.id)
        node = db.get(Node, node.parent_id) if node.parent_id else None
    return False


def authorize_board(db, connection, space_id, board_id, edit=False):
    user = db.get(User, connection.user_id)
    space, role = require_space(db, space_id, user)
    board = db.get(Node, board_id)
    if not board or board.space_id != space.id or board.type != "board" or not within(db, connection, space, board.id):
        raise HTTPException(403, "Outside connection scope")
    if edit and (not connection.grants["edit"] or role_at(db, space, role, user, board.id) == "viewer"):
        raise HTTPException(403, "Editing is not granted")
    return space, user, role


@router.get("/.well-known/oauth-authorization-server")
def oauth_metadata():
    base = settings.public_url + "/api/mcp/oauth"
    return {"issuer": settings.public_url, "authorization_endpoint": base + "/authorize", "token_endpoint": base + "/token",
            "registration_endpoint": base + "/register", "revocation_endpoint": base + "/revoke",
            "response_types_supported": ["code"], "grant_types_supported": ["authorization_code", "refresh_token"],
            "token_endpoint_auth_methods_supported": ["none"], "code_challenge_methods_supported": ["S256"],
            "scopes_supported": sorted(SCOPES)}


@router.get("/.well-known/oauth-protected-resource")
@router.get("/.well-known/oauth-protected-resource/mcp")
def protected_metadata():
    return {"resource": resource_url(), "authorization_servers": [settings.public_url], "scopes_supported": sorted(SCOPES), "bearer_methods_supported": ["header"]}


class Registration(BaseModel):
    model_config = ConfigDict(extra="ignore")
    client_name: str = Field(default="MCP client", max_length=120)
    redirect_uris: list[str] = Field(min_length=1, max_length=10)
    token_endpoint_auth_method: Literal["none"] = "none"
    grant_types: list[Literal["authorization_code", "refresh_token"]] = ["authorization_code", "refresh_token"]
    response_types: list[Literal["code"]] = ["code"]


@router.post("/api/mcp/oauth/register", status_code=201)
def register(body: Registration, request: Request):
    limit(request, "mcp-register", 20, 5)
    for value in body.redirect_uris:
        uri = urlsplit(value)
        if len(value) > 1000 or any(ord(c) < 33 for c in value) or uri.fragment or uri.username or uri.password or not uri.hostname or (uri.scheme != "https" and not (uri.scheme == "http" and uri.hostname in {"localhost", "127.0.0.1", "::1"})):
            raise HTTPException(400, "Invalid redirect URI")
    with atomic() as db:
        client = McpClient(name=body.client_name, redirects=body.redirect_uris)
        db.add(client)
        db.flush()
        return {"client_id": client.id, **body.model_dump()}


@router.get("/api/mcp/oauth/authorize")
def authorize(request: Request, client_id: str, redirect_uri: str, code_challenge: str, resource: str,
              response_type: str = "code", code_challenge_method: str = "S256", scope: str = "zoomz:read", state: str = ""):
    limit(request, "mcp-authorize", 60, 10)
    if response_type != "code" or code_challenge_method != "S256" or not re.fullmatch(r"[A-Za-z0-9_-]{43}", code_challenge) or resource != resource_url() or len(state) > 1024 or not set(scope.split()) <= SCOPES or "zoomz:read" not in scope.split():
        raise HTTPException(400, "Invalid OAuth request")
    with atomic() as db:
        client = db.get(McpClient, client_id)
        if not client or redirect_uri not in client.redirects:
            raise HTTPException(400, "Unregistered redirect URI")
        pending = McpPending(payload={"client_id": client.id, "redirect_uri": redirect_uri, "challenge": code_challenge, "scope": scope, "state": state, "resource": resource}, expires=clock() + 600)
        db.add(pending)
        db.flush()
        return RedirectResponse(settings.public_url + "/mcp-connect?" + urlencode({"request": pending.id}), status_code=303)


@router.get("/api/mcp/consent/{identifier}")
def consent_info(identifier: str, user=Depends(require_user)):
    with atomic() as db:
        pending = db.get(McpPending, identifier)
        if not pending or pending.expires <= clock():
            raise HTTPException(400, "Consent request expired")
        return {"client": db.get(McpClient, pending.payload["client_id"]).name, "requested_scope": pending.payload["scope"], "redirect_uri": pending.payload["redirect_uri"]}


@router.post("/api/mcp/consent/{identifier}")
def consent(identifier: str, body: Grants, user=Depends(require_user)):
    with atomic() as db:
        pending = db.scalar(select(McpPending).where(McpPending.id == identifier).with_for_update())
        if not pending or pending.expires <= clock():
            raise HTTPException(400, "Consent request expired")
        payload = pending.payload
        if body.edit and "zoomz:edit" not in payload["scope"].split():
            raise HTTPException(400, "Client did not request editing")
        if body.destructive == "elevated":
            raise HTTPException(400, "Grant elevation separately after connecting")
        connection = McpConnection(user_id=user.id, client_id=payload["client_id"], grants=validate_grants(db, user, body))
        db.add(connection)
        db.flush()
        code = new_token()
        db.add(McpCredential(digest=hash_token(code), connection_id=connection.id, kind="code", expires=clock() + 120, payload=payload))
        audit(db, connection, "consent", connection.grants)
        db.delete(pending)
        uri = urlsplit(payload["redirect_uri"])
        query = parse_qsl(uri.query) + [("code", code), ("state", payload["state"])]
        return {"redirect": urlunsplit((uri.scheme, uri.netloc, uri.path, urlencode(query), ""))}


def issue(db, connection, offline):
    access, refresh = new_token(), new_token()
    scopes = "zoomz:read" + (" zoomz:edit" if connection.grants["edit"] else "")
    db.add(McpCredential(digest=hash_token(access), connection_id=connection.id, kind="access", expires=clock() + 900, payload={"resource": resource_url()}))
    result = {"access_token": access, "token_type": "Bearer", "expires_in": 900, "scope": scopes}
    if offline:
        db.add(McpCredential(digest=hash_token(refresh), connection_id=connection.id, kind="refresh", expires=clock() + 30 * 86400, payload={"resource": resource_url()}))
        result["refresh_token"] = refresh
        result["scope"] += " offline_access"
    return result


@router.post("/api/mcp/oauth/token")
async def token(request: Request):
    limit(request, "mcp-token", 120, 20)
    form = await request.form(max_fields=15)
    grant = form.get("grant_type")
    raw = form.get("code" if grant == "authorization_code" else "refresh_token", "")
    if not isinstance(raw, str) or len(raw) > 500 or form.get("resource") != resource_url():
        return JSONResponse({"error": "invalid_grant"}, status_code=400)
    with atomic() as db:
        credential = db.scalar(select(McpCredential).where(McpCredential.digest == hash_token(raw)).with_for_update())
        if not credential:
            return JSONResponse({"error": "invalid_grant"}, status_code=400)
        connection = connection_for(db, credential.connection_id)
        if form.get("client_id") != connection.client_id or credential.expires <= clock():
            return JSONResponse({"error": "invalid_grant"}, status_code=400)
        if grant == "authorization_code" and credential.kind == "code":
            verifier = form.get("code_verifier", "")
            if not isinstance(verifier, str) or not re.fullmatch(r"[A-Za-z0-9._~-]{43,128}", verifier):
                return JSONResponse({"error": "invalid_grant"}, status_code=400)
            challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
            if challenge != credential.payload["challenge"] or form.get("redirect_uri") != credential.payload["redirect_uri"]:
                return JSONResponse({"error": "invalid_grant"}, status_code=400)
            offline = "offline_access" in credential.payload["scope"].split()
        elif grant == "refresh_token" and credential.kind == "refresh":
            offline = True
        else:
            return JSONResponse({"error": "invalid_grant"}, status_code=400)
        if credential.used:
            connection.revoked = True
            audit(db, connection, "credential_replay")
            return JSONResponse({"error": "invalid_grant"}, status_code=400)
        credential.used = True
        return JSONResponse(issue(db, connection, offline), headers={"Cache-Control": "no-store", "Pragma": "no-cache"})


@router.post("/api/mcp/oauth/revoke")
async def revoke_token(request: Request):
    limit(request, "mcp-revoke", 60, 10)
    form = await request.form(max_fields=5)
    raw = form.get("token", "")
    if isinstance(raw, str) and len(raw) <= 500:
        with atomic() as db:
            credential = db.get(McpCredential, hash_token(raw))
            if credential:
                connection = db.scalar(select(McpConnection).where(McpConnection.id == credential.connection_id).with_for_update())
                if connection and not connection.revoked and connection.client_id == form.get("client_id"):
                    connection.revoked = True
                    audit(db, connection, "revoke")
    return {}


@router.get("/api/mcp/connections")
def connections(user=Depends(require_user)):
    with atomic() as db:
        rows = db.scalars(select(McpConnection).where(McpConnection.user_id == user.id).limit(100))
        return {"endpoint": resource_url(), "connections": [{"id": c.id, "client": db.get(McpClient, c.client_id).name, "grants": c.grants, "revoked": c.revoked} for c in rows]}


@router.put("/api/mcp/connections/{identifier}")
def change_grants(identifier: str, body: Grants, user=Depends(require_user)):
    with atomic() as db:
        connection = connection_for(db, identifier)
        if connection.user_id != user.id:
            raise HTTPException(404)
        connection.grants = validate_grants(db, user, body)
        audit(db, connection, "permissions", connection.grants)
    return {"ok": True}


@router.delete("/api/mcp/connections/{identifier}")
def revoke_connection(identifier: str, user=Depends(require_user)):
    with atomic() as db:
        connection = connection_for(db, identifier)
        if connection.user_id != user.id:
            raise HTTPException(404)
        connection.revoked = True
        audit(db, connection, "revoke")
    return {"ok": True}
