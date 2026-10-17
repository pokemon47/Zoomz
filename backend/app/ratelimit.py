"""Small in-process token-bucket rate limiter (the API runs as a single instance)."""

from __future__ import annotations

import threading
import time

from fastapi import HTTPException, Request


class Limiter:
    def __init__(self) -> None:
        self._buckets: dict[str, tuple[float, float]] = {}
        self._lock = threading.Lock()

    def hit(self, key: str, rate_per_min: float, burst: int) -> bool:
        now = time.monotonic()
        with self._lock:
            tokens, last = self._buckets.get(key, (float(burst), now))
            tokens = min(float(burst), tokens + (now - last) * rate_per_min / 60.0)
            if tokens < 1:
                self._buckets[key] = (tokens, now)
                return False
            self._buckets[key] = (tokens - 1, now)
            if len(self._buckets) > 50_000:  # crude cap against unbounded growth
                self._buckets.clear()
            return True


limiter = Limiter()


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def limit(request: Request, name: str, rate_per_min: float, burst: int, key: str | None = None) -> None:
    if not limiter.hit(f"{name}:{key or client_ip(request)}", rate_per_min, burst):
        raise HTTPException(429, "Too many requests. Wait a moment and try again.")
