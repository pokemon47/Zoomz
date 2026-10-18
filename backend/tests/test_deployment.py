import importlib.util
import hashlib
import io
import json
import tarfile
from pathlib import Path

import pytest

from app.preflight import check_storage

spec = importlib.util.spec_from_file_location("backup", Path(__file__).resolve().parents[2] / "deploy" / "backup.py")
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


def test_chromium_seccomp_only_adds_documented_namespace_permissions():
    profile_path = Path(__file__).resolve().parents[2] / 'deploy/seccomp/chromium.json'
    profile = json.loads(profile_path.read_text())
    assert profile['syscalls'].pop(0) == {
        'comment': 'Allow create user namespaces', 'names': ['clone', 'setns', 'unshare'],
        'action': 'SCMP_ACT_ALLOW', 'args': [], 'includes': {}, 'excludes': {},
    }
    canonical = json.dumps(profile, sort_keys=True, separators=(',', ':')).encode()
    assert hashlib.sha256(canonical).hexdigest() == '9da637d2ab0a204fcbd91bd88f1be9e004a3acab61c571a9f5b8870e588a17d2'


def test_storage_is_writable_or_fails_clearly(tmp_path):
    check_storage(tmp_path / "uploads")
    blocked = tmp_path / "file"
    blocked.write_text("not a directory")
    with pytest.raises(RuntimeError, match="STORAGE_DIR"):
        check_storage(blocked)


def test_production_refuses_ephemeral_media(tmp_path, monkeypatch):
    monkeypatch.setattr(Path, "is_mount", lambda self: False)
    with pytest.raises(RuntimeError, match="persistent volume mount"):
        check_storage(tmp_path / "uploads", require_mount=True)


def test_paired_backup_checksums_and_restore(tmp_path):
    stage = tmp_path / "stage"
    stage.mkdir()
    (stage / "database.dump").write_bytes(b"database test data")
    (stage / "uploads.tar").write_bytes(b"media test data")
    target = tmp_path / "paired.tar"
    backup.pack(stage, target)
    restored = tmp_path / "restored"
    restored.mkdir()
    backup.unpack(target, restored)
    assert (restored / "database.dump").read_bytes() == b"database test data"
    assert (restored / "uploads.tar").read_bytes() == b"media test data"
    (stage / "database.dump").write_bytes(b"corrupted")
    with tarfile.open(target, "w") as archive:
        for name in backup.MEMBERS:
            archive.add(stage / name, arcname=name)
    with pytest.raises(ValueError, match="checksum"):
        backup.unpack(target, restored)


def test_restore_rejects_unsafe_archive(tmp_path):
    target = tmp_path / "bad.tar"
    with tarfile.open(target, "w") as archive:
        member = tarfile.TarInfo("../../outside")
        member.size = 1
        archive.addfile(member, io.BytesIO(b"x"))
    with pytest.raises(ValueError, match="Not a Zoomz"):
        backup.unpack(target, tmp_path)


def test_live_edits_and_drag_previews_recheck_access(make_client):
    from app.db import SessionLocal
    from app.live import _apply, _drag
    from app.models import User
    from app.ops import OpError

    owner = make_client("deployment-owner@example.com")
    outsider = make_client("deployment-outsider@example.com")
    sid = owner.get("/api/spaces").json()["mine"][0]["id"]
    scene = owner.get(f"/api/spaces/{sid}/scene").json()
    image = next(n for n in scene["nodes"] if n["type"] == "image")
    preview = {"id": image["id"], "parentId": image["parentId"], "x": 10, "y": 20}
    with SessionLocal() as db:
        user = db.get(User, owner.me["id"])
        other = db.get(User, outsider.me["id"])
        assert _drag(sid, user, preview)["x"] == 10
        assert _drag(sid, user, {**preview, "x": float("nan")}) is None
        assert _drag(sid, user, {**preview, "parentId": image["id"]}) is None
        assert _drag(sid, other, preview) is None
        with pytest.raises(OpError, match="access"):
            _apply(sid, other, "owner", {"type": "update", "id": image["id"], "patch": {"x": 99}}, "stale")


def test_postgres_concurrent_edits_allocate_distinct_sequences(make_client):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    from uuid import uuid4
    from app.db import SessionLocal, engine
    from app.models import Space, User
    from app.ops import apply

    if engine.dialect.name != "postgresql":
        pytest.skip("PostgreSQL row-lock behavior is exercised by CI")
    owner = make_client("postgres-concurrency@example.com")
    sid = owner.get("/api/spaces").json()["mine"][0]["id"]
    before = owner.get(f"/api/spaces/{sid}/scene").json()["seq"]
    barrier = Barrier(2)

    def edit(_):
        with SessionLocal() as db:
            space = db.get(Space, sid)
            user = db.get(User, owner.me["id"])
            barrier.wait(timeout=10)
            return apply(db, space, user, "owner", {"type": "create", "node": {"id": f"race-{uuid4().hex}", "type": "note", "parentId": space.root_board_id, "content": {"title": "Concurrent edit"}}})["seq"]

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(edit, range(2))) == [before + 1, before + 2]


def test_invalid_presence_cannot_send_an_invalid_camera_to_peers(make_client):
    owner = make_client("safe-presence@example.com")
    sid = owner.get("/api/spaces").json()["mine"][0]["id"]
    root = owner.get(f"/api/spaces/{sid}/scene").json()["rootBoardId"]
    with owner.websocket_connect(f"/api/spaces/{sid}/live") as a, owner.websocket_connect(f"/api/spaces/{sid}/live") as b:
        a.receive_json()
        b.receive_json()
        a.receive_json()
        b.send_json({"t": "presence", "view": {"b": root, "x": 0, "y": 0, "w": 0, "h": 0}})
        assert "view" not in a.receive_json()["peer"]


def test_pdf_upload_has_a_readable_preview(make_client):
    import pypdfium2

    pdf = pypdfium2.PdfDocument.new()
    pdf.new_page(200, 300)
    stream = io.BytesIO()
    pdf.save(stream)
    pdf.close()
    owner = make_client("pdf-deployment@example.com")
    sid = owner.get("/api/spaces").json()["mine"][0]["id"]
    result = owner.post(f"/api/spaces/{sid}/files", headers={"X-Zoomz": "1"}, files={"file": ("test.pdf", stream.getvalue(), "application/pdf")})
    assert result.status_code == 200
    assert result.json()["kind"] == "pdf" and result.json()["width"] == 200
    assert owner.get(result.json()["preview"]).headers["content-type"] == "image/webp"
