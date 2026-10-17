"""Search across your boards, and link previews for pasted URLs."""

from __future__ import annotations

import ipaddress
import re
import socket
from html import unescape
from typing import Any, Optional
from urllib.parse import parse_qs, quote, urljoin, urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .auth import require_user
from .db import get_db
from .models import Node, Space, SpaceMember, User, WorkspaceMember
from .ops import files_for, node_out
from .ratelimit import limit

router = APIRouter(prefix="/api", tags=["discover"])


@router.get("/search")
def search(q: str, request: Request, space: Optional[str] = None, user: User = Depends(require_user), db: Session = Depends(get_db)) -> list:
    q = q.strip().lower()
    if len(q) < 2:
        return []
    limit(request, "search", 120, 30, key=user.id)
    ws_ids = select(WorkspaceMember.workspace_id).where(WorkspaceMember.user_id == user.id)
    sp_ids = select(SpaceMember.space_id).where(SpaceMember.user_id == user.id)
    spaces = {s.id: s for s in db.scalars(select(Space).where(or_(Space.workspace_id.in_(ws_ids), Space.id.in_(sp_ids))))}
    if space:
        spaces = {k: v for k, v in spaces.items() if k == space}
    if not spaces:
        return []
    terms = [t for t in re.split(r"\s+", q) if t][:5]
    stmt = select(Node).where(Node.space_id.in_(list(spaces)))
    for t in terms:
        stmt = stmt.where(Node.search_text.contains(t))
    rows = list(db.scalars(stmt.limit(40)))
    files = files_for(db, rows)
    out = []
    for n in rows:
        # The path of boards from the top, so the client can fly there.
        path, cur = [], n.parent_id
        while cur:
            b = db.get(Node, cur)
            if not b:
                break
            path.insert(0, {"id": b.id, "title": (b.content or {}).get("title", "")})
            cur = b.parent_id
        out.append({"spaceId": n.space_id, "spaceTitle": spaces[n.space_id].title, "node": node_out(n, files), "path": path})
    return out


# ---------------------------------------------------------------- link previews


def _public_host(host: str) -> bool:
    """Refuse anything that resolves to a private, loopback or link-local address (SSRF)."""
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return False
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved or ip.is_unspecified:
            return False
    return True


META = re.compile(r"<meta\s+[^>]*?(?:property|name)\s*=\s*[\"']([^\"']+)[\"'][^>]*?content\s*=\s*[\"']([^\"']*)[\"'][^>]*>", re.I)
META_REV = re.compile(r"<meta\s+[^>]*?content\s*=\s*[\"']([^\"']*)[\"'][^>]*?(?:property|name)\s*=\s*[\"']([^\"']+)[\"'][^>]*>", re.I)
TITLE = re.compile(r"<title[^>]*>(.*?)</title>", re.I | re.S)


def embed_for(url: str) -> Optional[str]:
    u = urlparse(url)
    host = (u.hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    if host in ("youtube.com", "m.youtube.com") and u.path == "/watch":
        vid = parse_qs(u.query).get("v", [""])[0]
        return f"https://www.youtube-nocookie.com/embed/{vid}" if re.match(r"^[\w-]{6,20}$", vid) else None
    if host == "youtu.be":
        vid = u.path.strip("/")
        return f"https://www.youtube-nocookie.com/embed/{vid}" if re.match(r"^[\w-]{6,20}$", vid) else None
    if host == "vimeo.com" and re.match(r"^/\d+$", u.path):
        return f"https://player.vimeo.com/video{u.path}"
    if host in ("figma.com",) and re.match(r"^/(file|design|proto|board)/", u.path):
        return f"https://www.figma.com/embed?embed_host=zoomz&url={quote(url, safe='')}"
    return None


OEMBED = {
    "youtube.com": "https://www.youtube.com/oembed?format=json&url={}",
    "youtu.be": "https://www.youtube.com/oembed?format=json&url={}",
    "vimeo.com": "https://vimeo.com/api/oembed.json?url={}",
}


def _oembed(url: str) -> Optional[dict[str, Any]]:
    host = (urlparse(url).hostname or "").lower()
    host = host[4:] if host.startswith("www.") else host
    host = "youtube.com" if host == "m.youtube.com" else host
    endpoint = OEMBED.get(host)
    if not endpoint:
        return None
    try:
        r = httpx.get(endpoint.format(quote(url, safe="")), timeout=6)
        r.raise_for_status()
        data = r.json()
    except (httpx.HTTPError, ValueError):
        return None
    thumb = data.get("thumbnail_url")
    return {
        "title": str(data.get("title") or url)[:300],
        "description": f"by {data['author_name']}"[:600] if data.get("author_name") else "",
        "image": thumb if isinstance(thumb, str) and thumb.startswith("https://") else None,
        "site": str(data.get("provider_name") or host)[:120],
    }


@router.get("/unfurl")
def unfurl(url: str, request: Request, user: User = Depends(require_user)) -> dict:
    limit(request, "unfurl", 60, 20, key=user.id)
    if not re.match(r"^https?://", url) or len(url) > 2000:
        raise HTTPException(422, "Only http and https links can be previewed.")
    out: dict[str, Any] = {"url": url, "title": url, "description": "", "image": None, "site": urlparse(url).hostname or "", "embed": embed_for(url)}
    known = _oembed(url)  # video sites describe themselves properly via oEmbed
    if known:
        return {**out, **known}
    try:
        current = url
        with httpx.Client(timeout=6, follow_redirects=False, headers={"User-Agent": "ZoomzBot/1.0 (+link preview)"}) as client:
            for _ in range(4):  # follow redirects ourselves so every hop is checked
                host = urlparse(current).hostname or ""
                if not _public_host(host):
                    return out
                with client.stream("GET", current) as r:
                    if r.is_redirect and r.headers.get("location"):
                        current = urljoin(current, r.headers["location"])
                        continue
                    if "text/html" not in r.headers.get("content-type", ""):
                        return out
                    body = b""
                    for chunk in r.iter_bytes():
                        body += chunk
                        if b"</head>" in body[-len(chunk) - 8 :] or len(body) > 1_000_000:
                            break  # metadata lives in <head>
                    html = body.decode(r.encoding or "utf-8", errors="replace")
                    break
            else:
                return out
    except httpx.HTTPError:
        return out
    meta: dict[str, str] = {}
    for k, v in META.findall(html):
        meta.setdefault(k.lower(), unescape(v).strip())
    for v, k in META_REV.findall(html):
        meta.setdefault(k.lower(), unescape(v).strip())
    title = meta.get("og:title") or meta.get("twitter:title")
    if not title:
        m = TITLE.search(html)
        title = unescape(m.group(1)).strip() if m else None
    image = meta.get("og:image") or meta.get("twitter:image")
    out.update(
        {
            "title": (title or url)[:300],
            "description": (meta.get("og:description") or meta.get("description") or "")[:600],
            "image": urljoin(current, image) if image and urljoin(current, image).startswith("https://") else None,
            "site": (meta.get("og:site_name") or urlparse(current).hostname or "")[:120],
        }
    )
    return out
