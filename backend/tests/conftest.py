import os
import tempfile

# Isolated database and storage for the whole test run, set before the app is imported.
_tmp = tempfile.mkdtemp(prefix="zoomz-test-")
# CI also runs this suite against Postgres by setting TEST_DATABASE_URL (after `alembic upgrade head`).
os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL") or f"sqlite:///{_tmp}/test.db"
os.environ["STORAGE_DIR"] = f"{_tmp}/files"
os.environ["APP_ENV"] = "development"
os.environ["PUBLIC_URL"] = "http://testserver"
os.environ.pop("SMTP_HOST", None)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

H = {"X-Zoomz": "1"}


def sign_in(client: TestClient, email: str) -> dict:
    r = client.post("/api/auth/magic-link", json={"email": email}, headers=H)
    assert r.status_code == 200, r.text
    link = r.json()["devLink"]
    token = link.rsplit("/", 1)[1]
    r = client.post("/api/auth/verify", json={"token": token}, headers=H)
    assert r.status_code == 200, r.text
    me = client.get("/api/me")
    assert me.status_code == 200
    return me.json()


@pytest.fixture()
def make_client():
    clients = []

    def make(email=None):
        c = TestClient(app)
        c.__enter__()
        clients.append(c)
        if email:
            c.me = sign_in(c, email)
        return c

    yield make
    for c in clients:
        c.__exit__(None, None, None)


@pytest.fixture(autouse=True)
def no_rate_limits(request, monkeypatch):
    """Tests sign in many people from one address; only the rate-limit test keeps limits on."""
    if "ratelimit" not in request.keywords:
        from app.ratelimit import limiter

        monkeypatch.setattr(limiter, "hit", lambda *a, **k: True)
