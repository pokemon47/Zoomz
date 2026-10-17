from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import time

from .config import settings


def new_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    """Tokens (sessions, magic links, invites) are stored only as SHA-256 hashes."""
    return hashlib.sha256(token.encode()).hexdigest()


def _mac(msg: str) -> str:
    digest = hmac.new(settings.secret_key.encode(), msg.encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest[:18]).decode().rstrip("=")


def sign_path(path: str, ttl_seconds: int = 7 * 24 * 3600) -> str:
    """A file URL that works without a cookie until it expires (for <img>, public links, downloads)."""
    exp = int(time.time()) + ttl_seconds
    # Round expiry to the hour so URLs (and browser caches) stay stable across reloads.
    exp -= exp % 3600
    sep = "&" if "?" in path else "?"
    return f"{path}{sep}exp={exp}&sig={_mac(f'{path}|{exp}')}"


def verify_signed(path: str, exp: str, sig: str) -> bool:
    try:
        if int(exp) < time.time():
            return False
    except ValueError:
        return False
    return hmac.compare_digest(_mac(f"{path}|{exp}"), sig)
