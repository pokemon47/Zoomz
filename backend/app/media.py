"""What an upload is, whether it's safe, and the previews we make from it."""

from __future__ import annotations

import io
import logging
import math
import shutil
import socket
import struct
import subprocess
import threading
from pathlib import Path
from typing import Optional

import filetype
from defusedxml import ElementTree as SafeET

from .config import settings

log = logging.getLogger("zoomz.media")

THUMBS = (256, 1024)
_pdf_lock = threading.Lock()

BLOCKED_EXT = {
    "exe", "dll", "msi", "com", "scr", "bat", "cmd", "ps1", "vbs", "jar", "app", "dmg", "pkg", "apk", "deb", "rpm",
    "sh", "bin", "elf", "so", "dylib", "iso", "lnk", "reg", "hta", "cpl", "msc", "gadget",
}
BLOCKED_MIME_PREFIX = ("application/x-msdownload", "application/x-executable", "application/x-mach-binary", "application/x-sharedlib", "application/x-dosexec", "application/vnd.microsoft.portable-executable")
RASTER = {"image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp", "image/tiff", "image/avif"}
BROWSER_VIDEO = {"video/mp4", "video/webm"}


class Rejected(Exception):
    """An upload we won't store; the message is shown to the user."""


def classify(head: bytes, filename: str, declared: str) -> tuple[str, str]:
    """Return (mime, kind) from the file's actual bytes, falling back to its name for text formats."""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext in BLOCKED_EXT:
        raise Rejected("Programs and installers can't be added to a board.")
    guess = filetype.guess(head)
    mime = guess.mime if guess else ""
    if mime.startswith(BLOCKED_MIME_PREFIX) or head[:2] == b"MZ" or head[:4] in (b"\x7fELF", b"\xcf\xfa\xed\xfe", b"\xca\xfe\xba\xbe"):
        raise Rejected("Programs and installers can't be added to a board.")
    if not mime:
        text_like = _looks_like_text(head)
        if ext == "svg" or (text_like and b"<svg" in head[:2048].lower()):
            mime = "image/svg+xml"
        elif text_like:
            mime = {"csv": "text/csv", "md": "text/markdown", "json": "application/json", "html": "text/html"}.get(ext, "text/plain")
        else:
            mime = declared if declared and not declared.startswith(("text/html", "application/javascript")) else "application/octet-stream"
    return mime, kind_of(mime, ext)


def kind_of(mime: str, ext: str = "") -> str:
    if mime.startswith("image/"):
        return "image"
    if mime.startswith("video/"):
        return "video"
    if mime.startswith("audio/"):
        return "audio"
    if mime == "application/pdf":
        return "pdf"
    if "zip" in mime or "compressed" in mime or ext in {"zip", "rar", "7z", "gz", "tar"}:
        return "document" if ext in {"docx", "xlsx", "pptx", "key", "pages", "numbers"} else "archive"
    if "font" in mime or ext in {"ttf", "otf", "woff", "woff2"}:
        return "font"
    if mime.startswith("text/") or ext in {"doc", "docx", "xls", "xlsx", "ppt", "pptx", "rtf", "odt", "md"}:
        return "document"
    return "other"


def _looks_like_text(head: bytes) -> bool:
    if b"\x00" in head[:4096]:
        return False
    try:
        head[:4096].decode("utf-8")
        return True
    except UnicodeDecodeError:
        return False


# ---------------------------------------------------------------- SVG


SVG_NS = "{http://www.w3.org/2000/svg}"
XLINK = "{http://www.w3.org/1999/xlink}href"
BAD_TAGS = {"script", "foreignobject", "iframe", "embed", "object", "handler", "listener"}


def sanitize_svg(path: Path) -> None:
    """Strip scripts, event handlers and external references; rewrite the file in place."""
    try:
        tree = SafeET.parse(str(path), forbid_dtd=True, forbid_entities=True, forbid_external=True)
    except Exception as exc:  # noqa: BLE001 - any parse problem means we won't keep it
        raise Rejected("That SVG couldn't be read safely.") from exc
    root = tree.getroot()
    if not root.tag.lower().endswith("svg"):
        raise Rejected("That file isn't a valid SVG.")
    for parent in list(root.iter()):
        for child in list(parent):
            tag = child.tag.split("}")[-1].lower() if isinstance(child.tag, str) else ""
            if tag in BAD_TAGS:
                parent.remove(child)
    for el in root.iter():
        for attr in list(el.attrib):
            name = attr.split("}")[-1].lower()
            value = el.attrib[attr].strip().lower()
            if name.startswith("on"):
                del el.attrib[attr]
            elif name == "href" or attr == XLINK:
                if not (value.startswith("#") or value.startswith("data:image/")):
                    del el.attrib[attr]
            elif "javascript:" in value or ("url(" in value and "url(#" not in value):
                del el.attrib[attr]
        if isinstance(el.tag, str) and el.tag.split("}")[-1].lower() == "style" and el.text:
            if "@import" in el.text.lower() or "url(" in el.text.lower():
                el.text = ""
    import xml.etree.ElementTree as ET

    ET.register_namespace("", "http://www.w3.org/2000/svg")
    ET.register_namespace("xlink", "http://www.w3.org/1999/xlink")
    path.write_bytes(ET.tostring(root, encoding="utf-8", xml_declaration=True))


# ---------------------------------------------------------------- previews


def image_previews(src: Path, out_dir: Path) -> tuple[Optional[int], Optional[int], dict[str, str]]:
    """Downscaled WebP copies so far-away cards never load full-size originals."""
    from PIL import Image, ImageOps

    variants: dict[str, str] = {}
    with Image.open(src) as im:
        im = ImageOps.exif_transpose(im)
        w, h = im.size
        frame = im.convert("RGBA") if im.mode in ("RGBA", "LA", "P") else im.convert("RGB")
        for size in THUMBS:
            if max(w, h) <= size and size != THUMBS[0]:
                continue
            copy = frame.copy()
            copy.thumbnail((size, size))
            name = f"thumb_{size}.webp"
            copy.save(out_dir / name, "WEBP", quality=82, method=4)
            variants[f"thumb_{size}"] = name
    return w, h, variants


def pdf_page(src: Path, number: int, max_edge: int = 1024):
    """Render one page using the shared PDFium lock; callers own the copied PIL image."""
    import pypdfium2 as pdfium

    # PDFium is not thread-safe; uploads and MCP reads can run in separate workers.
    with _pdf_lock:
        pdf = pdfium.PdfDocument(str(src))
        try:
            count = len(pdf)
            if not 1 <= number <= count or not 1 <= max_edge <= 1600:
                raise ValueError("Invalid PDF page or resolution")
            page = pdf[number - 1]
            try:
                pw, ph = page.get_size()
                if not all(math.isfinite(v) and v > 0 for v in (pw, ph)):
                    raise ValueError("Invalid PDF dimensions")
                bitmap = page.render(scale=max_edge / max(pw, ph))
                try:
                    return bitmap.to_pil().copy(), count, int(pw), int(ph)
                finally:
                    bitmap.close()
            finally:
                page.close()
        finally:
            pdf.close()


def pdf_preview(src: Path, out_dir: Path) -> tuple[Optional[int], Optional[int], dict[str, str]]:
    img, _, pw, ph = pdf_page(src, 1)
    try:
        img.save(out_dir / "preview.webp", "WEBP", quality=82)
        small = img.copy()
        small.thumbnail((256, 256))
        small.save(out_dir / "thumb_256.webp", "WEBP", quality=80)
        small.close()
        return pw, ph, {"preview": "preview.webp", "thumb_1024": "preview.webp", "thumb_256": "thumb_256.webp"}
    finally:
        img.close()


def ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


def video_derivatives(src: Path, out_dir: Path, mime: str) -> dict[str, str]:
    """Poster frame, and a web-friendly H.264 MP4 when the original isn't one browsers play."""
    if not ffmpeg_available():
        return {}
    variants: dict[str, str] = {}
    poster = out_dir / "poster.webp"
    r = subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-ss", "0.5", "-i", str(src), "-frames:v", "1", "-vf", "scale='min(1024,iw)':-2", str(poster)],
        capture_output=True,
        timeout=60,
    )
    if r.returncode == 0 and poster.exists():
        variants["poster"] = "poster.webp"
        variants["thumb_1024"] = "poster.webp"
    if mime not in BROWSER_VIDEO:
        web = out_dir / "web.mp4"
        r = subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-vf", "scale='min(1280,iw)':-2", "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(web)],
            capture_output=True,
            timeout=1800,
        )
        if r.returncode == 0 and web.exists():
            variants["web"] = "web.mp4"
    return variants


# ---------------------------------------------------------------- malware scan


def scan(path: Path) -> None:
    """Stream the file to clamd (INSTREAM) when CLAMAV_ADDRESS is set; raise Rejected on a hit."""
    if not settings.clamav:
        return
    host, _, port = settings.clamav.partition(":")
    try:
        with socket.create_connection((host, int(port or 3310)), timeout=30) as s, open(path, "rb") as f:
            s.sendall(b"zINSTREAM\0")
            while True:
                chunk = f.read(64 * 1024)
                if not chunk:
                    break
                s.sendall(struct.pack(">L", len(chunk)) + chunk)
            s.sendall(struct.pack(">L", 0))
            reply = io.BytesIO()
            while not reply.getvalue().endswith(b"\0"):
                data = s.recv(4096)
                if not data:
                    break
                reply.write(data)
    except OSError:
        log.exception("virus scanner unreachable")
        raise Rejected("We couldn't check that file for viruses right now. Try again in a minute.")
    text = reply.getvalue().decode(errors="replace")
    if "FOUND" in text:
        log.warning("rejected infected upload: %s", text.strip())
        raise Rejected("That file looks infected, so it wasn't added.")
