"""Uploading and serving files on the storage volume."""

from __future__ import annotations

import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Any, BinaryIO, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from . import media, storage
from .auth import current_user_optional, require_user
from .config import settings
from .db import SessionLocal, get_db
from .live import hub
from .models import StoredFile, User, new_id
from .ops import file_urls
from .permissions import require_space
from .ratelimit import limit
from .security import verify_signed

log = logging.getLogger("zoomz.files")
router = APIRouter(prefix="/api", tags=["files"])
# Slow derivatives (video transcodes) run one at a time off the request path.
worker = ThreadPoolExecutor(max_workers=1, thread_name_prefix="media")
_lock = threading.Lock()

INLINE_KINDS = {"image", "video", "audio", "pdf"}


def file_out(f: StoredFile) -> dict[str, Any]:
    return {"id": f.id, "filename": f.filename, **file_urls(f)}


@router.post("/spaces/{space_id}/files")
def upload(space_id: str, request: Request, file: UploadFile = File(...), user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    return store_upload(space_id, request, file, user, db)


def store_upload(space_id, request, file, user, db, *, commit=True, file_id=None):
    space, role = require_space(db, space_id, user, "viewer")
    from .permissions import can_edit, role_at

    board = request.query_params.get("board")
    if not can_edit(role_at(db, space, role, user, board)):
        raise HTTPException(403, "You can only view this board.")
    limit(request, "upload", 120, 40, key=user.id)
    if storage.used_bytes(space.id) >= settings.space_quota_mb * 1024 * 1024:
        raise HTTPException(413, f"This board has used its {settings.space_quota_mb // 1024} GB of storage. Remove some files first.")

    rec = ingest(db, space, user, file.file, file.filename or "file", file.content_type or "")
    return file_out(rec)


def ingest(db: Session, space, user: Optional[User], stream: BinaryIO, filename: str, content_type: str = "") -> StoredFile:
    """Store one file in a space: check its type from its bytes, size-limit, scan, sanitise
    SVGs, make previews. Commits and returns the record; raises HTTPException if refused."""
    max_bytes = settings.max_upload_mb * 1024 * 1024
    fid = new_id()
    name = (filename or "file").replace("/", "_").replace("\\", "_")[:255] or "file"
    head = stream.read(8192)
    stream.seek(0)
    try:
        mime, kind = media.classify(head, name, content_type or "")
    except media.Rejected as e:
        raise HTTPException(415, str(e))
    base = f"{space.id}/{fid}"
    try:
        size, sha = storage.write_stream(stream, f"{base}/original", max_bytes)
    except storage.TooLarge:
        storage.delete_dir(base)
        raise HTTPException(413, f"Files can be up to {settings.max_upload_mb} MB.")
    src = storage.path_for(f"{base}/original")
    try:
        media.scan(src)
        if mime == "image/svg+xml":
            media.sanitize_svg(src)
    except media.Rejected as e:
        storage.delete_dir(base)
        raise HTTPException(422, str(e))

    rec = StoredFile(id=fid, space_id=space.id, uploader_id=user.id if user else None, filename=name, mime=mime, kind=kind, size=size, sha256=sha, status="processing")
    # Fast previews inline (images, PDFs) so the card looks right immediately.
    try:
        if mime in media.RASTER:
            rec.width, rec.height, rec.variants = media.image_previews(src, src.parent)
        elif mime == "application/pdf":
            rec.width, rec.height, rec.variants = media.pdf_preview(src, src.parent)
    except Exception:  # noqa: BLE001 - a broken preview shouldn't lose the upload
        log.exception("preview failed for %s", fid)
    slow = kind == "video" and media.ffmpeg_available()
    rec.status = "processing" if slow else "ready"
    db.add(rec)
    if commit:
        db.commit()
    else:
        db.flush()
    if slow and commit:
        worker.submit(_process_video, fid)
    return rec


def _process_video(fid: str) -> None:
    with SessionLocal() as db:
        f = db.get(StoredFile, fid)
        if not f:
            return
        src = storage.path_for(f"{f.space_id}/{f.id}/original")
        try:
            f.variants = {**(f.variants or {}), **media.video_derivatives(src, src.parent, f.mime)}
            f.status = "ready"
        except Exception:  # noqa: BLE001
            log.exception("video processing failed for %s", fid)
            f.status = "ready"  # the original still plays in most browsers
        db.commit()
        hub.publish(f.space_id, {"t": "file", "file": file_out(f)})


@router.get("/files/{file_id}/{variant}")
def serve(file_id: str, variant: str, request: Request, exp: Optional[str] = None, sig: Optional[str] = None, user: Optional[User] = Depends(current_user_optional), db: Session = Depends(get_db)):
    f = db.get(StoredFile, file_id)
    if not f:
        raise HTTPException(404, "File not found.")
    path = f"/api/files/{file_id}/{variant}"
    if not (exp and sig and verify_signed(path, exp, sig)):
        require_space(db, f.space_id, user, "viewer")
    name = "original" if variant == "original" else (f.variants or {}).get(variant)
    if not name:
        raise HTTPException(404, "That preview isn't available.")
    p = storage.path_for(f"{f.space_id}/{f.id}/{name}")
    if not p.exists():
        raise HTTPException(404, "File not found.")
    mime = f.mime if variant == "original" else ("video/mp4" if name.endswith(".mp4") else "image/webp")
    inline = f.kind in INLINE_KINDS or variant != "original"
    headers = {
        # User files never run as part of the app: no scripts, no plugins, opaque origin.
        "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=86400",
        "Cross-Origin-Resource-Policy": "same-origin",
    }
    return FileResponse(p, media_type=mime, headers=headers, filename=f.filename, content_disposition_type="inline" if inline else "attachment")


@router.post("/files/{file_id}/copy")
def copy_file(file_id: str, space: str, request: Request, user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    """Copy a file into another space you can edit (pasting across boards)."""
    f = db.get(StoredFile, file_id)
    if not f:
        raise HTTPException(404, "File not found.")
    require_space(db, f.space_id, user, "viewer")
    target, _ = require_space(db, space, user, "editor")
    if f.space_id == target.id:
        return file_out(f)
    limit(request, "copy", 120, 60, key=user.id)
    nid = new_id()
    src_dir, dst_dir = f"{f.space_id}/{f.id}", f"{target.id}/{nid}"
    for name in {"original", *(f.variants or {}).values()}:
        try:
            storage.copy(f"{src_dir}/{name}", f"{dst_dir}/{name}")
        except FileNotFoundError:
            pass
    rec = StoredFile(
        id=nid, space_id=target.id, uploader_id=user.id, filename=f.filename, mime=f.mime, kind=f.kind, size=f.size,
        sha256=f.sha256, width=f.width, height=f.height, variants=dict(f.variants or {}), status=f.status,
    )
    db.add(rec)
    db.commit()
    return file_out(rec)
