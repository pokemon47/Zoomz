"""Export one board (and everything inside it) as a zip you can browse and re-import later.

Folders mirror the nesting: each board is a folder holding its pictures and files under their
original names, its notes as Markdown and its links in `links.md`. `zoomz-manifest.json`
records the full structure and layout so Zoomz can rebuild it exactly.
"""

from __future__ import annotations

import io
import json
import re
import zipfile
from datetime import timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import current_user_optional
from .db import get_db
from .models import Node, StoredFile, User, now
from .permissions import require_space
from .storage import path_for

router = APIRouter(prefix="/api", tags=["export"])
STATIC_DIR = (Path(__file__).parent / "static").resolve()

MANIFEST_VERSION = 2
COORDINATES = (
    "Each item's x, y, w and h are in its parent board's own units: the parent's content "
    "window is `frame` (x, y, w, h) on that board, and the board card shows that window scaled "
    "to fit inside it. z is the height above the board's floor; rank is the stacking order "
    "among siblings (higher paints on top; null means the default order by type). Arrows keep "
    "their end points in content.x1/y1/x2/y2, relative to the arrow's own x and y; content.from "
    "and content.to name the items an end is attached to."
)
#: Item types that are plain geometry, with nothing to put in the folders.
SHAPES = {"arrow"}
UNSAFE = re.compile(r'[\x00-\x1f/\\:*?"<>|]')
ORDER = {"board": 0, "note": 1, "image": 2, "file": 3, "link": 4}


def safe_name(name: str, fallback: str) -> str:
    """A file or folder name that works on every OS: no path separators, reserved characters,
    leading dots or trailing spaces/dots."""
    out = UNSAFE.sub("_", (name or "").strip()).lstrip(".").rstrip(" .")
    return out[:120] or fallback


class Names:
    """Unique names within one folder: "Notes", "Notes (2)", ... (case-insensitive)."""

    def __init__(self) -> None:
        self.used: set[str] = set()

    def take(self, name: str) -> str:
        stem, dot, ext = name.rpartition(".") if "." in name[1:] else (name, "", "")
        candidate, n = name, 2
        while candidate.lower() in self.used:
            candidate = f"{stem} ({n}).{ext}" if dot else f"{name} ({n})"
            n += 1
        self.used.add(candidate.lower())
        return candidate


@router.get("/spaces/{space_id}/export")
def export_board(space_id: str, board: Optional[str] = None, user: Optional[User] = Depends(current_user_optional), db: Session = Depends(get_db)):
    space, _ = require_space(db, space_id, user, "viewer")
    nodes = {n.id: n for n in db.scalars(select(Node).where(Node.space_id == space.id))}
    root = nodes.get(board or space.root_board_id)
    if not root or root.type != "board":
        raise HTTPException(404, "No such board.")
    children: dict[str, list[Node]] = {}
    for n in nodes.values():
        if n.parent_id:
            children.setdefault(n.parent_id, []).append(n)
    file_ids = [str(n.content.get("fileId")) for n in nodes.values() if (n.content or {}).get("fileId")]
    files = {f.id: f for f in db.scalars(select(StoredFile).where(StoredFile.id.in_(file_ids), StoredFile.space_id == space.id))}

    root_title = (root.content or {}).get("title") or space.title
    top = safe_name(root_title, "Board")
    manifest_nodes: list[dict[str, Any]] = []
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:

        def walk(b: Node, folder: str) -> None:
            names = Names()
            for reserved in ("zoomz-manifest.json", "README.md", "links.md"):
                names.used.add(reserved.lower())
            links: list[str] = []
            kids = sorted(children.get(b.id, []), key=lambda n: (ORDER.get(n.type, 9), n.rank if n.rank is not None else 0, n.y, n.x))
            for n in kids:
                c = n.content or {}
                title = str(c.get("title") or "")
                entry: dict[str, Any] = {
                    "id": n.id, "type": n.type, "parentId": n.parent_id, "title": title,
                    "x": n.x, "y": n.y, "z": n.z, "w": n.w, "h": n.h, "rank": n.rank,
                    # Everything the item stores (title, captions, text, arrow ends…); uploaded
                    # files are referenced by `path` inside the archive instead of an id.
                    "content": {k: v for k, v in c.items() if k != "fileId"},
                }
                if n.type == "board":
                    path = f"{folder}/{names.take(safe_name(title, 'Board'))}"
                    entry |= {"path": path + "/", "frame": c.get("frame"), "description": c.get("description")}
                    manifest_nodes.append(entry)
                    walk(n, path)
                    continue
                if n.type in SHAPES:
                    manifest_nodes.append(entry)
                    continue
                if n.type == "note":
                    path = f"{folder}/{names.take(safe_name(title, 'Note') + '.md')}"
                    body = str(c.get("body") or "")
                    z.writestr(path, (f"# {title}\n\n{body}\n" if title else f"{body}\n"))
                    entry |= {"path": path, "body": body}
                elif n.type == "link":
                    url = str(c.get("url") or "")
                    links.append(f"- [{title or url}]({url})" + (f" — {c['description']}" if c.get("description") else ""))
                    entry |= {"url": url, "description": c.get("description"), "path": f"{folder}/links.md"}
                else:  # image / file
                    f = files.get(str(c.get("fileId") or ""))
                    entry |= {"alt": c.get("alt")} if n.type == "image" else {}
                    if f:
                        src = path_for(f"{space.id}/{f.id}/original")
                        if src.exists():
                            path = f"{folder}/{names.take(safe_name(f.filename, f.id + '.bin'))}"
                            z.write(src, path)
                            entry |= {"path": path, "mime": f.mime, "width": f.width, "height": f.height}
                    src_url = str(c.get("src") or "")
                    if "path" not in entry and src_url.startswith("/api/assets/"):
                        # Built-in artwork (starter boards) ships with the app rather than uploads.
                        asset = (STATIC_DIR / src_url[len("/api/assets/"):]).resolve()
                        if STATIC_DIR in asset.parents and asset.is_file():
                            path = f"{folder}/{names.take(safe_name(title, 'image') + asset.suffix)}"
                            z.write(asset, path)
                            entry["path"] = path
                    if "path" not in entry:
                        entry["missing"] = True  # the stored file is gone; the card is kept in the layout
                manifest_nodes.append(entry)
            if links:
                z.writestr(f"{folder}/links.md", "# Links\n\n" + "\n".join(links) + "\n")

        manifest_nodes.append({
            "id": root.id, "type": "board", "parentId": None, "title": root_title, "path": top + "/",
            "x": root.x, "y": root.y, "z": root.z, "w": root.w, "h": root.h, "rank": root.rank,
            "frame": (root.content or {}).get("frame"), "content": dict(root.content or {}),
        })
        walk(root, top)
        manifest = {
            "zoomzExport": MANIFEST_VERSION,
            "exportedAt": now().astimezone(timezone.utc).isoformat(),
            "space": {"id": space.id, "title": space.title, "scenery": space.scenery},
            "rootBoardId": root.id,
            "coordinates": COORDINATES,
            "nodes": manifest_nodes,
        }
        z.writestr(f"{top}/zoomz-manifest.json", json.dumps(manifest, indent=2, ensure_ascii=False))
        z.writestr(
            f"{top}/README.md",
            f"# {root_title}\n\nExported from Zoomz. Each folder is a board; notes are Markdown files and links are in "
            "`links.md`. `zoomz-manifest.json` keeps the exact layout (positions, sizes, stacking) so the board can be rebuilt.\n",
        )
    buf.seek(0)
    filename = safe_name(root_title, "board")
    ascii_name = filename.encode("ascii", "ignore").decode() or "board"
    from urllib.parse import quote

    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename=\"{ascii_name}.zip\"; filename*=UTF-8''{quote(filename)}.zip"},
    )
