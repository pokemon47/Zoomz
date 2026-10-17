"""File storage on the Zenith file-storage volume (a plain directory; STORAGE_DIR).

Layout: <STORAGE_DIR>/<space_id>/<file_id>/<name>. Nothing outside STORAGE_DIR is ever
read or written: keys are generated server-side and checked against the root.
"""

from __future__ import annotations

import hashlib
import os
import shutil
from pathlib import Path
from typing import BinaryIO

from .config import settings
from .security import sign_path

CHUNK = 1024 * 1024


class TooLarge(Exception):
    pass


def root() -> Path:
    settings.storage_dir.mkdir(parents=True, exist_ok=True)
    return settings.storage_dir


def path_for(key: str) -> Path:
    p = (root() / key).resolve()
    if root().resolve() not in p.parents:
        raise ValueError("storage key escapes the storage root")
    return p


def write_stream(src: BinaryIO, key: str, max_bytes: int) -> tuple[int, str]:
    """Copy an upload to storage, enforcing a size limit. Returns (size, sha256)."""
    dest = path_for(key)
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    digest = hashlib.sha256()
    size = 0
    try:
        with open(tmp, "wb") as out:
            while True:
                chunk = src.read(CHUNK)
                if not chunk:
                    break
                size += len(chunk)
                if size > max_bytes:
                    raise TooLarge()
                digest.update(chunk)
                out.write(chunk)
        os.replace(tmp, dest)
    finally:
        if tmp.exists():
            tmp.unlink()
    return size, digest.hexdigest()


def copy(src_key: str, dest_key: str) -> None:
    dest = path_for(dest_key)
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(path_for(src_key), dest)


def delete_dir(prefix: str) -> None:
    p = path_for(prefix)
    if p.exists():
        shutil.rmtree(p, ignore_errors=True)


def used_bytes(space_id: str) -> int:
    p = root() / space_id
    if not p.exists():
        return 0
    return sum(f.stat().st_size for f in p.rglob("*") if f.is_file())


def file_url(file_id: str, variant: str = "original") -> str:
    return sign_path(f"/api/files/{file_id}/{variant}")
