"""Runtime settings, read once from the environment.

Every value has a safe local-development default, so `uvicorn app.main:app` works
with no configuration (SQLite file, uploads in ./data, magic links printed to the log).
"""

from __future__ import annotations

import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

BACKEND_DIR = Path(__file__).resolve().parent.parent


def _bool(name: str, default: bool) -> bool:
    v = os.environ.get(name)
    return default if v is None else v.strip().lower() in {"1", "true", "yes", "on"}


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    env: str = field(default_factory=lambda: os.environ.get("APP_ENV", "development"))
    #: Public origin of the app, e.g. https://zoomz.example.com (Zenith: ZENITH_PUBLIC_URL).
    public_url: str = field(default_factory=lambda: os.environ.get("PUBLIC_URL", "http://localhost:5173").rstrip("/"))
    database_url: str = field(
        default_factory=lambda: os.environ.get("DATABASE_URL", f"sqlite:///{BACKEND_DIR / 'data' / 'zoomz.db'}")
    )
    #: Where uploaded files and their derivatives live (Zenith file-storage volume in production).
    storage_dir: Path = field(default_factory=lambda: Path(os.environ.get("STORAGE_DIR", str(BACKEND_DIR / "data" / "files"))))
    #: Signs file URLs and share tokens. Must be set (and stable) in production.
    secret_key: str = field(default_factory=lambda: os.environ.get("SECRET_KEY", ""))
    session_days: int = field(default_factory=lambda: _int("SESSION_DAYS", 30))
    magic_link_minutes: int = field(default_factory=lambda: _int("MAGIC_LINK_MINUTES", 20))

    smtp_host: Optional[str] = field(default_factory=lambda: os.environ.get("SMTP_HOST") or None)
    smtp_port: int = field(default_factory=lambda: _int("SMTP_PORT", 587))
    smtp_user: Optional[str] = field(default_factory=lambda: os.environ.get("SMTP_USER") or None)
    smtp_password: Optional[str] = field(default_factory=lambda: os.environ.get("SMTP_PASSWORD") or None)
    smtp_from: str = field(default_factory=lambda: os.environ.get("SMTP_FROM", "Zoomz <no-reply@localhost>"))
    smtp_tls: bool = field(default_factory=lambda: _bool("SMTP_TLS", True))

    google_client_id: Optional[str] = field(default_factory=lambda: os.environ.get("GOOGLE_CLIENT_ID") or None)
    google_client_secret: Optional[str] = field(default_factory=lambda: os.environ.get("GOOGLE_CLIENT_SECRET") or None)

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


def load_settings() -> Settings:
    s = Settings()
    if not s.secret_key:
        if not s.dev:
            raise RuntimeError("SECRET_KEY must be set in production")
        # Development: a per-process key is fine (sessions are in the DB; file URLs just re-sign).
        object.__setattr__(s, "secret_key", secrets.token_urlsafe(32))
    return s


settings = load_settings()
