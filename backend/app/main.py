"""Zoomz API.

Accounts, spaces (moodboards) and their contents, sharing, file storage, search, link
previews, and live collaboration. The original read-only demo endpoint is kept for the
public landing page and tests.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from datetime import timedelta
from functools import lru_cache
from pathlib import Path
from typing import List, Literal, Optional, Union

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import delete, select, text

from . import account, auth, canvas, discover, export, files, live, spaces, mail
from .config import settings
from .db import SessionLocal, engine

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)
log = logging.getLogger("zoomz")

APP_DIR = Path(__file__).resolve().parent
DATA_FILE = APP_DIR / "data" / "demo-board.json"
STATIC_DIR = APP_DIR / "static"

def private_error_event(event, hint):
    # Authentication links can occur in requests and breadcrumbs. Keep them out of telemetry.
    event.pop("request", None)
    event.pop("breadcrumbs", None)
    return event


if settings.sentry_dsn:
    import sentry_sdk

    sentry_sdk.init(dsn=settings.sentry_dsn, environment=settings.env, traces_sample_rate=0, send_default_pii=False, include_local_variables=False, before_send=private_error_event)


# ---------------------------------------------------------------- demo scene contract (unchanged)


class BoardContent(BaseModel):
    title: str
    description: Optional[str] = None


class ImageContent(BaseModel):
    title: str
    src: str
    alt: str


class NoteContent(BaseModel):
    title: str
    body: str


class BaseNode(BaseModel):
    id: str
    parentId: Optional[str]
    x: float
    y: float
    z: float = 0  # height above the parent board's floor, local units
    w: float
    h: float


class BoardNode(BaseNode):
    type: Literal["board"]
    content: BoardContent


class ImageNode(BaseNode):
    type: Literal["image"]
    content: ImageContent


class NoteNode(BaseNode):
    type: Literal["note"]
    content: NoteContent


class Scene(BaseModel):
    rootBoardId: str
    nodes: List[Union[BoardNode, ImageNode, NoteNode]]


@lru_cache(maxsize=1)
def load_scene() -> Scene:
    return Scene.model_validate(json.loads(DATA_FILE.read_text()))


# ---------------------------------------------------------------- app

app = FastAPI(title="Zoomz API", version="1.0.0", docs_url="/api/docs" if settings.dev else None, redoc_url=None, openapi_url="/api/openapi.json" if settings.dev else None)

UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}


@app.exception_handler(mail.DeliveryError)
async def email_unavailable(request: Request, exc: mail.DeliveryError):
    return JSONResponse({"detail": str(exc)}, status_code=503)


@app.middleware("http")
async def guard(request: Request, call_next):
    # CSRF: cookies are SameSite=Lax, and every state-changing API call must also carry a
    # custom header, which a cross-site form or image can't send.
    if request.method in UNSAFE and request.url.path.startswith("/api/") and request.headers.get("x-zoomz") != "1":
        return JSONResponse({"detail": "Missing request header."}, status_code=403)
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    if request.url.path.startswith("/api/") and "cache-control" not in response.headers:
        response.headers["Cache-Control"] = "no-store"
    return response


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    log.exception("unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse({"detail": "Something went wrong on our side. Try again in a moment."}, status_code=500)


@app.get("/api/health")
def health() -> dict:
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    return {"status": "ok"}


@app.get("/api/demo-board", response_model=Scene)
def demo_board() -> Scene:
    return load_scene()


class ClientError(BaseModel):
    message: str
    stack: Optional[str] = None
    url: Optional[str] = None


@app.post("/api/client-errors")
def client_error(body: ClientError, request: Request) -> dict:
    from .ratelimit import limit

    limit(request, "client-error", 30, 10)
    log.warning("Client error reported; client-supplied details omitted for privacy")
    if settings.sentry_dsn:
        import sentry_sdk

        sentry_sdk.capture_message("Client error reported", level="error")
    return {"ok": True}


for r in (auth.router, account.router, spaces.router, canvas.router, files.router, discover.router, export.router, live.router):
    app.include_router(r)

app.mount("/api/assets", StaticFiles(directory=STATIC_DIR), name="assets")


# ---------------------------------------------------------------- startup & housekeeping


@app.on_event("startup")
def startup() -> None:
    from .preflight import check_storage

    check_storage(settings.storage_dir, require_mount=not settings.dev)
    if settings.database_url.startswith("sqlite"):
        # Local development and tests run the same migrations production runs (the container
        # does `alembic upgrade head` before starting), so schemas never drift apart.
        migrate()
    threading.Thread(target=_housekeeping, daemon=True, name="housekeeping").start()


def migrate() -> None:
    from alembic import command
    from alembic.config import Config

    cfg = Config(str(APP_DIR.parent / "alembic.ini"))
    cfg.set_main_option("script_location", str(APP_DIR.parent / "alembic"))
    command.upgrade(cfg, "head")


def _housekeeping() -> None:
    from . import ops as ops_mod
    from .models import LoginToken, Node, StoredFile, UserSession, now
    from .storage import delete_dir

    time.sleep(30)
    while True:
        try:
            with SessionLocal() as db:
                cutoff = now()
                db.execute(delete(UserSession).where(UserSession.expires_at < cutoff))
                db.execute(delete(LoginToken).where(LoginToken.expires_at < cutoff - timedelta(days=1)))
                db.commit()
                ops_mod.prune_log(db)
                # Files no item points to for 30 days (undo window is long gone): remove.
                referenced = {
                    (c or {}).get("fileId") for c in db.scalars(select(Node.content).where(Node.type.in_(("image", "file"))))
                }
                old = cutoff - timedelta(days=30)
                for f in db.scalars(select(StoredFile).where(StoredFile.created_at < old)):
                    if f.id not in referenced:
                        delete_dir(f"{f.space_id}/{f.id}")
                        db.delete(f)
                db.commit()
        except Exception:  # noqa: BLE001
            log.exception("housekeeping failed")
        time.sleep(6 * 3600)
