"""Runtime settings, read once from the environment.

Every value has a safe local-development default, so `uvicorn app.main:app` works
with no configuration (SQLite file, uploads in ./data, development links in responses).
"""

from __future__ import annotations

import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional
from email.utils import parseaddr
from urllib.parse import urlsplit

BACKEND_DIR = Path(__file__).resolve().parent.parent


def _bool(name: str, default: bool) -> bool:
    v = os.environ.get(name)
    return default if v is None else v.strip().lower() in {"1", "true", "yes", "on"}


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        raise RuntimeError(f"{name} must be an integer") from None


@dataclass(frozen=True)
class Settings:
    env: str = field(default_factory=lambda: os.environ.get("APP_ENV", "development"))
    #: Public HTTPS origin, supplied explicitly by the deployment operator.
    public_url: str = field(default_factory=lambda: os.environ.get("PUBLIC_URL", "http://localhost:5173").rstrip("/"))
    database_url: str = field(
        default_factory=lambda: os.environ.get("DATABASE_URL", f"sqlite:///{BACKEND_DIR / 'data' / 'zoomz.db'}"), repr=False
    )
    #: Where uploaded files and their derivatives live (Zenith file-storage volume in production).
    storage_dir: Path = field(default_factory=lambda: Path(os.environ.get("STORAGE_DIR", str(BACKEND_DIR / "data" / "files"))))
    #: Signs file URLs and share tokens. Must be set (and stable) in production.
    secret_key: str = field(default_factory=lambda: os.environ.get("SECRET_KEY", ""), repr=False)
    session_days: int = field(default_factory=lambda: _int("SESSION_DAYS", 30))
    #: How long someone who joined through an emailed invite can use Zoomz before signing in.
    guest_days: int = field(default_factory=lambda: _int("GUEST_DAYS", 14))
    #: How long an emailed invite link stays valid.
    invite_days: int = field(default_factory=lambda: _int("INVITE_DAYS", 14))
    magic_link_minutes: int = field(default_factory=lambda: _int("MAGIC_LINK_MINUTES", 20))

    smtp_host: Optional[str] = field(default_factory=lambda: os.environ.get("SMTP_HOST") or None)
    smtp_port: int = field(default_factory=lambda: _int("SMTP_PORT", 587))
    smtp_user: Optional[str] = field(default_factory=lambda: os.environ.get("SMTP_USER") or None, repr=False)
    smtp_password: Optional[str] = field(default_factory=lambda: os.environ.get("SMTP_PASSWORD") or None, repr=False)
    smtp_from: str = field(default_factory=lambda: os.environ.get("SMTP_FROM", "Zoomz <no-reply@localhost>"))
    smtp_tls: bool = field(default_factory=lambda: _bool("SMTP_TLS", True))
    smtp_encryption: str = field(default_factory=lambda: os.environ.get("SMTP_ENCRYPTION", "").lower())
    smtp_from_name: str = field(default_factory=lambda: os.environ.get("SMTP_FROM_NAME", ""))
    smtp_timeout: int = field(default_factory=lambda: _int("SMTP_TIMEOUT", 15))

    google_client_id: Optional[str] = field(default_factory=lambda: os.environ.get("GOOGLE_CLIENT_ID") or None)
    google_client_secret: Optional[str] = field(default_factory=lambda: os.environ.get("GOOGLE_CLIENT_SECRET") or None, repr=False)

    #: Per-file and per-space upload limits.
    max_upload_mb: int = field(default_factory=lambda: _int("MAX_UPLOAD_MB", 200))
    space_quota_mb: int = field(default_factory=lambda: _int("SPACE_QUOTA_MB", 5120))
    #: Optional ClamAV daemon (host:port). Uploads are scanned when set.
    clamav: Optional[str] = field(default_factory=lambda: os.environ.get("CLAMAV_ADDRESS") or None)
    sentry_dsn: Optional[str] = field(default_factory=lambda: os.environ.get("SENTRY_DSN") or None)

    @property
    def dev(self) -> bool:
        return self.env != "production"

    @property
    def secure_cookies(self) -> bool:
        return self.public_url.startswith("https://")

    @property
    def mail_encryption(self) -> str:
        return self.smtp_encryption or ("tls" if self.smtp_port == 465 else "starttls" if self.smtp_tls else "none")


def load_settings() -> Settings:
    s = Settings()
    if s.env not in {"development", "production"}:
        raise RuntimeError("APP_ENV must be development or production")
    if s.mail_encryption not in {"starttls", "tls", "none"}:
        raise RuntimeError("SMTP_ENCRYPTION must be starttls, tls, or none")
    if not 1 <= s.smtp_port <= 65535:
        raise RuntimeError("SMTP_PORT must be between 1 and 65535")
    if not 1 <= s.smtp_timeout <= 120:
        raise RuntimeError("SMTP_TIMEOUT must be between 1 and 120 seconds")
    if bool(s.smtp_user) != bool(s.smtp_password):
        raise RuntimeError("SMTP_USER and SMTP_PASSWORD must be supplied together")
    if not s.dev:
        if not s.smtp_encryption:
            raise RuntimeError("SMTP_ENCRYPTION must be explicitly configured in production")
        origin = urlsplit(s.public_url)
        if origin.scheme != "https" or not origin.hostname or origin.username or origin.password or origin.path or origin.query or origin.fragment or any(c.isspace() for c in s.public_url):
            raise RuntimeError("PUBLIC_URL must be a public HTTPS origin without a path")
        if not s.database_url.startswith(("postgresql://", "postgresql+psycopg://")):
            raise RuntimeError("DATABASE_URL must explicitly configure PostgreSQL in production")
        if not os.environ.get("STORAGE_DIR") or not s.storage_dir.is_absolute():
            raise RuntimeError("STORAGE_DIR must be an explicit absolute persistent-storage path")
        if not s.smtp_host or any(c.isspace() or c in "/@" for c in s.smtp_host):
            raise RuntimeError("SMTP_HOST must configure the instance SMTP server")
        address = parseaddr(s.smtp_from)[1]
        if "@" not in address or "." not in address.split("@")[-1] or "\n" in s.smtp_from or "\r" in s.smtp_from:
            raise RuntimeError("SMTP_FROM must be a valid sender email address")
        if any(c in s.smtp_from_name for c in "\r\n"):
            raise RuntimeError("SMTP_FROM_NAME must not contain newlines")
        if len(s.secret_key) < 32:
            raise RuntimeError("SECRET_KEY must contain at least 32 characters in production")
    if s.database_url.startswith("postgresql://"):
        object.__setattr__(s, "database_url", s.database_url.replace("postgresql://", "postgresql+psycopg://", 1))
    if not s.secret_key:
        if not s.dev:
            raise RuntimeError("SECRET_KEY must be set in production")
        # Development: a per-process key is fine (sessions are in the DB; file URLs just re-sign).
        object.__setattr__(s, "secret_key", secrets.token_urlsafe(32))
    return s


settings = load_settings()
