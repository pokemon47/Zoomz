"""Disposable CI container checks. Never run against a real instance."""

import os
import sys
import urllib.request
from pathlib import Path

assert os.environ.get("ZOOMZ_CONTAINER_TEST") == "1", "Only run in a disposable CI project"

from sqlalchemy import select
from websockets.sync.client import connect

from app.auth import get_or_create_user
from app.db import SessionLocal
from app.models import Node, Space, StoredFile, new_id
from app.ops import file_urls
from app.storage import path_for


with SessionLocal() as db:
    if sys.argv[1] == "seed":
        from PIL import Image
        import pypdfium2

        # Check the PDF native runtime is loadable in the minimal Linux app image too.
        pdf = pypdfium2.PdfDocument.new()
        pdf.close()

        user, _ = get_or_create_user(db, "ci-probe@example.com")
        space = db.scalar(select(Space).where(Space.created_by == user.id))
        space.public_token = "ci-public-token"
        fid = new_id()
        file = path_for(f"{space.id}/{fid}/original")
        file.parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGB", (16, 16), (255, 142, 114)).save(file, format="PNG")
        import hashlib

        db.add(StoredFile(id=fid, space_id=space.id, uploader_id=user.id, filename="ci-probe.png", mime="image/png", kind="image", size=file.stat().st_size, sha256=hashlib.sha256(file.read_bytes()).hexdigest(), status="ready"))
        db.flush()
        db.add(Node(id="ci-persistent-image", space_id=space.id, parent_id=space.root_board_id, type="image", x=12, y=34, w=200, h=200, content={"title": "CI image", "alt": "CI", "fileId": fid}))
        db.commit()
    elif sys.argv[1] == "verify":
        import hashlib

        node = db.get(Node, "ci-persistent-image")
        assert node and node.x == 12 and node.y == 34
        file = db.get(StoredFile, node.content["fileId"])
        space = db.get(Space, node.space_id)
        payload = urllib.request.urlopen("http://127.0.0.1:8080" + file_urls(file)["src"], timeout=10).read()
        assert hashlib.sha256(payload).hexdigest() == file.sha256
        with connect(f"ws://127.0.0.1:8080/api/spaces/{space.id}/live?public={space.public_token}", open_timeout=10) as socket:
            import json

            assert json.loads(socket.recv())["role"] == "viewer"
            socket.send(json.dumps({"t": "op", "cid": "denied", "op": {"type": "delete", "id": node.id}}))
            assert json.loads(socket.recv())["t"] == "reject"
        print("Database/media persistence, protected media, WebSocket proxy, and viewer rejection passed")
    else:
        raise SystemExit("Expected seed or verify")
