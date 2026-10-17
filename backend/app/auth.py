"""Accounts and sign-in: email magic links, optional Google sign-in, cookie sessions."""

from __future__ import annotations

import hashlib
import logging
import random
import re
import secrets
from datetime import timedelta
from typing import Optional
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import mail
from .config import settings
from .db import get_db
from .models import LoginToken, User, UserSession, Workspace, WorkspaceMember, now
from .ratelimit import limit
from .security import hash_token, new_token

log = logging.getLogger("zoomz.auth")
router = APIRouter(prefix="/api/auth", tags=["auth"])

COOKIE = "zb_session"
EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$")
COLORS = ["#FF8E72", "#6E8BFF", "#E2B33B", "#3FB984", "#A98BF5", "#F26D8F", "#2BB5C8"]


# ---------------------------------------------------------------- dependencies


def current_user_optional(request: Request, db: Session = Depends(get_db)) -> Optional[User]:
    token = request.cookies.get(COOKIE)
    if not token:
        return None
    sess = db.scalar(select(UserSession).where(UserSession.token_hash == hash_token(token)))
    if not sess or _aware(sess.expires_at) < now():
        return None
    if guest_expired(sess.user):
        request.state.guest_expired = sess.user.email
        return None
    return sess.user


def require_user(request: Request, user: Optional[User] = Depends(current_user_optional)) -> User:
    if not user:
        email = getattr(request.state, "guest_expired", None)
        if email:
            raise HTTPException(401, {"message": "Your guest access has ended. Sign in to keep using Zoomz.", "reason": "guest_expired", "email": email})
        raise HTTPException(401, "Sign in to continue.")
    return user


def guest_expired(user: User) -> bool:
    return bool(user.guest_until) and _aware(user.guest_until) <= now()


def _aware(dt):
    # SQLite returns naive datetimes; treat them as UTC.
    from datetime import timezone

    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


# ---------------------------------------------------------------- accounts


def get_or_create_user(db: Session, email: str, name: str = "", avatar_url: Optional[str] = None, guest: bool = False) -> tuple[User, bool]:
    """Find or create the account for an email. `guest` marks a new account made by redeeming
    an emailed invite: it works for `GUEST_DAYS`, then its owner must sign in normally."""
    email = email.strip().lower()
    user = db.scalar(select(User).where(User.email == email))
    if user:
        if avatar_url and not user.avatar_url:
            user.avatar_url = avatar_url
        return user, False
    user = User(
        email=email,
        name=(name or email.split("@")[0].replace(".", " ").title())[:80],
        color=random.choice(COLORS),
        avatar_url=avatar_url,
        guest_until=now() + timedelta(days=settings.guest_days) if guest else None,
    )
    db.add(user)
    db.flush()
    ws = Workspace(name="Personal", owner_id=user.id, personal=True)
    db.add(ws)
    db.flush()
    db.add(WorkspaceMember(workspace_id=ws.id, user_id=user.id, role="owner"))
    from .seed import create_starter_space

    create_starter_space(db, ws, user)
    return user, True


def start_session(db: Session, response: Response, user: User, request: Request) -> None:
    """A fixed-length session: using Zoomz doesn't extend it. Guests' sessions end with their
    guest period; everyone else's after `SESSION_DAYS`."""
    token = new_token()
    expires = now() + timedelta(days=settings.session_days)
    if user.guest_until:
        expires = min(expires, _aware(user.guest_until))
    db.add(
        UserSession(
            user_id=user.id,
            token_hash=hash_token(token),
            expires_at=expires,
            user_agent=(request.headers.get("user-agent") or "")[:300],
        )
    )
    response.set_cookie(
        COOKIE,
        token,
        max_age=max(60, int((expires - now()).total_seconds())),
        httponly=True,
        secure=settings.secure_cookies,
        samesite="lax",
        path="/",
    )


def safe_next(path: Optional[str]) -> str:
    """Only same-site relative paths, so a sign-in link can't bounce you to another site."""
    if not path or not path.startswith("/") or path.startswith("//") or "\\" in path:
        return "/"
    return path[:300]


# ---------------------------------------------------------------- routes


@router.get("/config")
def auth_config() -> dict:
    return {"google": bool(settings.google_client_id and settings.google_client_secret), "dev": settings.dev}


class MagicLinkIn(BaseModel):
    email: str
    next: Optional[str] = None


@router.post("/magic-link")
def magic_link(body: MagicLinkIn, request: Request, db: Session = Depends(get_db)) -> dict:
    email = body.email.strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(422, "That doesn't look like an email address.")
    limit(request, "magic-ip", 10, 5)
    limit(request, "magic-email", 4, 3, key=email)
    token = new_token()
    db.add(
        LoginToken(
            email=email,
            token_hash=hash_token(token),
            next_path=safe_next(body.next),
            expires_at=now() + timedelta(minutes=settings.magic_link_minutes),
        )
    )
    # The link opens a page with a button; only that button's POST uses the token, so mail
    # scanners that open links don't burn it.
    link = f"{settings.public_url}/signin/{token}"
    mail.send(
        email,
        "Your Zoomz sign-in link",
        f"Here's your link to sign in to Zoomz. It works once and expires in {settings.magic_link_minutes} minutes.\n\nIf you didn't ask for it, you can ignore this email.",
        ("Sign in to Zoomz", link),
    )
    db.commit()
    out: dict = {"sent": True}
    if settings.dev and not settings.smtp_host:
        out["devLink"] = link  # local development only: no mail server to deliver it
    return out


@router.get("/verify")
def verify_link(token: str):
    """Links from older emails: show the confirm page rather than signing in on a GET."""
    return RedirectResponse(f"/signin/{token}", status_code=303)


class VerifyIn(BaseModel):
    token: str


@router.post("/verify")
def verify(body: VerifyIn, request: Request, response: Response, db: Session = Depends(get_db)) -> dict:
    row = db.scalar(select(LoginToken).where(LoginToken.token_hash == hash_token(body.token)))
    if not row or row.used_at or _aware(row.expires_at) < now():
        raise HTTPException(410, "That sign-in link has expired or was already used. Ask for a new one.")
    row.used_at = now()
    user, _ = get_or_create_user(db, row.email)
    user.guest_until = None  # signing in normally makes a guest a full account
    start_session(db, response, user, request)
    db.commit()
    return {"next": row.next_path or "/"}


@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)) -> dict:
    end_session(db, request, response)
    db.commit()
    return {"ok": True}


def end_session(db: Session, request: Request, response: Response) -> None:
    """Revoke this browser's session on the server and clear its cookie (caller commits)."""
    token = request.cookies.get(COOKIE)
    if token:
        sess = db.scalar(select(UserSession).where(UserSession.token_hash == hash_token(token)))
        if sess:
            db.delete(sess)
    response.delete_cookie(COOKIE, path="/")


# ---------------------------------------------------------------- Google


GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO = "https://openidconnect.googleapis.com/v1/userinfo"


def _google_redirect() -> str:
    return f"{settings.public_url}/api/auth/google/callback"


@router.get("/google/start")
def google_start(request: Request, next: Optional[str] = None):
    if not settings.google_client_id:
        raise HTTPException(404, "Google sign-in isn't set up.")
    limit(request, "google", 20, 10)
    state = secrets.token_urlsafe(24)
    verifier = secrets.token_urlsafe(48)
    challenge = _b64(hashlib.sha256(verifier.encode()).digest())
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": _google_redirect(),
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "prompt": "select_account",
    }
    resp = RedirectResponse(f"{GOOGLE_AUTH}?{urlencode(params)}", status_code=303)
    for k, v in (("zb_oauth_state", state), ("zb_oauth_verifier", verifier), ("zb_oauth_next", safe_next(next))):
        resp.set_cookie(k, v, max_age=600, httponly=True, secure=settings.secure_cookies, samesite="lax", path="/api/auth")
    return resp


@router.get("/google/callback")
def google_callback(request: Request, code: str = "", state: str = "", db: Session = Depends(get_db)):
    if not settings.google_client_id or not code or state != request.cookies.get("zb_oauth_state"):
        return RedirectResponse("/login?error=google", status_code=303)
    try:
        with httpx.Client(timeout=10) as client:
            tok = client.post(
                GOOGLE_TOKEN,
                data={
                    "code": code,
                    "client_id": settings.google_client_id,
                    "client_secret": settings.google_client_secret,
                    "redirect_uri": _google_redirect(),
                    "grant_type": "authorization_code",
                    "code_verifier": request.cookies.get("zb_oauth_verifier", ""),
                },
            )
            tok.raise_for_status()
            info = client.get(GOOGLE_USERINFO, headers={"Authorization": f"Bearer {tok.json()['access_token']}"})
            info.raise_for_status()
            data = info.json()
    except (httpx.HTTPError, KeyError, ValueError):
        log.warning("Google sign-in failed")
        return RedirectResponse("/login?error=google", status_code=303)
    if not data.get("email") or not data.get("email_verified"):
        return RedirectResponse("/login?error=google", status_code=303)
    user, _ = get_or_create_user(db, data["email"], data.get("name") or "", data.get("picture"))
    user.guest_until = None
    resp = RedirectResponse(safe_next(request.cookies.get("zb_oauth_next")), status_code=303)
    for k in ("zb_oauth_state", "zb_oauth_verifier", "zb_oauth_next"):
        resp.delete_cookie(k, path="/api/auth")
    start_session(db, resp, user, request)
    db.commit()
    return resp


def _b64(b: bytes) -> str:
    import base64

    return base64.urlsafe_b64encode(b).decode().rstrip("=")
