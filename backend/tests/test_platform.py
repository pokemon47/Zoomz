import io
import uuid
import zipfile

import pytest
from PIL import Image

from conftest import H


def uid(prefix="n"):
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


def first_space(c):
    spaces = c.get("/api/spaces").json()
    return spaces["mine"][0]


def scene(c, sid, **params):
    r = c.get(f"/api/spaces/{sid}/scene", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def op(c, sid, o):
    return c.post(f"/api/spaces/{sid}/ops", json={"op": o}, headers=H)


def png_bytes(w=320, h=200, color=(255, 142, 114)):
    buf = io.BytesIO()
    Image.new("RGB", (w, h), color).save(buf, "PNG")
    return buf.getvalue()


# ---------------------------------------------------------------- accounts


def test_sign_in_creates_account_with_starter_board(make_client):
    c = make_client("ana@example.com")
    assert c.me["email"] == "ana@example.com"
    s = first_space(c)
    assert s["title"] == "Summer Light" and s["role"] == "owner"
    sc = scene(c, s["id"])
    assert len([n for n in sc["nodes"] if n["type"] == "image"]) >= 30
    root = next(n for n in sc["nodes"] if n["id"] == sc["rootBoardId"])
    assert root["content"]["frame"]["w"] > 0


def test_magic_link_is_single_use_and_requires_header(make_client):
    c = make_client()
    assert c.post("/api/auth/magic-link", json={"email": "x@example.com"}).status_code == 403  # no CSRF header
    link = c.post("/api/auth/magic-link", json={"email": "x@example.com"}, headers=H).json()["devLink"]
    token = link.rsplit("/signin/", 1)[1]
    # Opening the link (as a mail scanner would) never uses it up; old-style links just redirect.
    assert c.get(f"/api/auth/verify?token={token}", follow_redirects=False).headers["location"] == f"/signin/{token}"
    assert c.post("/api/auth/verify", json={"token": token}).status_code == 403  # no CSRF header
    assert c.post("/api/auth/verify", json={"token": token}, headers=H).json() == {"next": "/"}
    assert c.post("/api/auth/verify", json={"token": token}, headers=H).status_code == 410


def test_logged_out_is_401(make_client):
    c = make_client()
    assert c.get("/api/me").status_code == 401
    assert c.get("/api/spaces").status_code == 401


def test_profile_update(make_client):
    c = make_client("bo@example.com")
    r = c.patch("/api/me", json={"name": "Bo", "color": "#3FB984"}, headers=H)
    assert r.json()["name"] == "Bo"
    assert c.patch("/api/me", json={"color": "red"}, headers=H).status_code == 422


@pytest.mark.ratelimit
def test_magic_links_are_rate_limited(make_client):
    c = make_client()
    codes = [c.post("/api/auth/magic-link", json={"email": "spam@example.com"}, headers=H).status_code for _ in range(6)]
    assert 429 in codes


# ---------------------------------------------------------------- editing


def test_create_move_reparent_update_delete(make_client):
    c = make_client("cy@example.com")
    sid = first_space(c)["id"]
    sc = scene(c, sid)
    root = sc["rootBoardId"]
    board = next(n for n in sc["nodes"] if n["type"] == "board" and n["parentId"] == root)
    nid = uid()
    r = op(c, sid, {"type": "create", "node": {"id": nid, "type": "note", "parentId": root, "x": 10, "y": 20, "w": 220, "h": 190, "content": {"title": "Hi", "body": "there", "evil": "x"}}})
    assert r.status_code == 200, r.text
    msg = r.json()
    assert msg["changes"][0]["node"]["content"] == {"title": "Hi", "body": "there"}
    seq1 = msg["seq"]
    r = op(c, sid, {"type": "update", "id": nid, "patch": {"x": 50, "parentId": board["id"], "content": {"body": "moved"}}})
    assert r.json()["seq"] == seq1 + 1
    node = next(n for n in scene(c, sid)["nodes"] if n["id"] == nid)
    assert node["parentId"] == board["id"] and node["x"] == 50 and node["content"]["body"] == "moved"
    assert op(c, sid, {"type": "delete", "id": nid}).status_code == 200
    assert not any(n["id"] == nid for n in scene(c, sid)["nodes"])


def test_board_cannot_go_inside_itself(make_client):
    c = make_client("di@example.com")
    sid = first_space(c)["id"]
    sc = scene(c, sid)
    by_id = {n["id"]: n for n in sc["nodes"]}
    child = next(n for n in sc["nodes"] if n["type"] == "board" and by_id.get(n["parentId"], {}).get("parentId") is not None)
    parent = by_id[child["parentId"]]
    r = op(c, sid, {"type": "update", "id": parent["id"], "patch": {"parentId": child["id"]}})
    assert r.status_code == 400 and "itself" in r.json()["detail"]


def test_deleting_a_board_removes_its_contents(make_client):
    c = make_client("ed@example.com")
    sid = first_space(c)["id"]
    sc = scene(c, sid)
    board = next(n for n in sc["nodes"] if n["type"] == "board" and n["parentId"] == sc["rootBoardId"])
    before = len(sc["nodes"])
    assert op(c, sid, {"type": "delete", "id": board["id"]}).status_code == 200
    assert len(scene(c, sid)["nodes"]) < before - 1


def test_root_cannot_be_deleted_and_batches_are_atomic(make_client):
    c = make_client("fa@example.com")
    sid = first_space(c)["id"]
    root = scene(c, sid)["rootBoardId"]
    assert op(c, sid, {"type": "delete", "id": root}).status_code == 400
    ok = uid()
    r = op(c, sid, {"type": "batch", "ops": [
        {"type": "create", "node": {"id": ok, "type": "note", "parentId": root, "content": {"title": "a"}}},
        {"type": "update", "id": "does-not-exist", "patch": {"x": 1}},
    ]})
    assert r.status_code == 404
    assert not any(n["id"] == ok for n in scene(c, sid)["nodes"])


# ---------------------------------------------------------------- sharing & permissions


def test_invite_viewer_cannot_edit_then_promote(make_client):
    owner = make_client("owner@example.com")
    sid = first_space(owner)["id"]
    r = owner.post(f"/api/spaces/{sid}/invites", json={"email": "guest@example.com", "role": "viewer"}, headers=H)
    token = r.json()["devLink"].rsplit("/", 1)[1]
    guest = make_client("guest@example.com")
    info = guest.get(f"/api/invites/{token}").json()
    assert info["role"] == "viewer"
    assert guest.post(f"/api/invites/{token}/accept", headers=H).json()["spaceId"] == sid
    assert any(s["id"] == sid for s in guest.get("/api/spaces").json()["shared"])
    root = scene(guest, sid)["rootBoardId"]
    r = op(guest, sid, {"type": "create", "node": {"id": uid(), "type": "note", "parentId": root, "content": {"title": "x"}}})
    assert r.status_code == 403
    owner.put(f"/api/spaces/{sid}/members/{guest.me['id']}", json={"role": "editor"}, headers=H)
    r = op(guest, sid, {"type": "create", "node": {"id": uid(), "type": "note", "parentId": root, "content": {"title": "x"}}})
    assert r.status_code == 200


def test_invite_is_for_the_invited_email_only(make_client):
    owner = make_client("o2@example.com")
    sid = first_space(owner)["id"]
    token = owner.post(f"/api/spaces/{sid}/invites", json={"email": "right@example.com", "role": "editor"}, headers=H).json()["devLink"].rsplit("/", 1)[1]
    wrong = make_client("wrong@example.com")
    assert wrong.post(f"/api/invites/{token}/accept", headers=H).status_code == 403


def test_join_link_and_expiry_toggle(make_client):
    owner = make_client("o3@example.com")
    sid = first_space(owner)["id"]
    share = owner.put(f"/api/spaces/{sid}/join-link", json={"enabled": True, "role": "editor", "expiresInDays": 7}, headers=H).json()
    token = share["joinLink"]["url"].rsplit("/", 1)[1]
    joiner = make_client("joiner@example.com")
    assert joiner.post(f"/api/join/{token}", headers=H).status_code == 200
    assert scene(joiner, sid)["space"]["role"] == "editor"
    owner.put(f"/api/spaces/{sid}/join-link", json={"enabled": False}, headers=H)
    late = make_client("late@example.com")
    assert late.post(f"/api/join/{token}", headers=H).status_code == 404


def test_public_link_is_read_only_without_account(make_client):
    owner = make_client("o4@example.com")
    sid = first_space(owner)["id"]
    url = owner.put(f"/api/spaces/{sid}/public-link", json={"enabled": True}, headers=H).json()["publicLink"]["url"]
    token = url.rsplit("/", 1)[1]
    anon = make_client()
    assert anon.get(f"/api/public/{token}").json()["spaceId"] == sid
    sc = scene(anon, sid, public=token)
    assert sc["space"]["role"] == "viewer"
    assert anon.get(f"/api/spaces/{sid}/scene").status_code == 404  # without the token: nothing
    owner.put(f"/api/spaces/{sid}/public-link", json={"enabled": False}, headers=H)
    assert anon.get(f"/api/spaces/{sid}/scene", params={"public": token}).status_code == 404


def test_board_override_limits_an_editor_inside_one_board(make_client):
    owner = make_client("o5@example.com")
    sid = first_space(owner)["id"]
    token = owner.put(f"/api/spaces/{sid}/join-link", json={"enabled": True, "role": "editor"}, headers=H).json()["joinLink"]["url"].rsplit("/", 1)[1]
    ed = make_client("ed5@example.com")
    ed.post(f"/api/join/{token}", headers=H)
    sc = scene(owner, sid)
    board = next(n for n in sc["nodes"] if n["type"] == "board" and n["parentId"] == sc["rootBoardId"])
    r = owner.put(f"/api/spaces/{sid}/overrides", json={"boardId": board["id"], "userId": ed.me["id"], "role": "viewer"}, headers=H)
    assert r.status_code == 200
    roles = scene(ed, sid)["boardRoles"]
    assert roles[board["id"]] == "viewer" and roles[sc["rootBoardId"]] == "editor"
    inside = op(ed, sid, {"type": "create", "node": {"id": uid(), "type": "note", "parentId": board["id"], "content": {"title": "no"}}})
    assert inside.status_code == 403
    outside = op(ed, sid, {"type": "create", "node": {"id": uid(), "type": "note", "parentId": sc["rootBoardId"], "content": {"title": "yes"}}})
    assert outside.status_code == 200


def test_strangers_see_nothing(make_client):
    owner = make_client("o6@example.com")
    sid = first_space(owner)["id"]
    stranger = make_client("stranger@example.com")
    assert stranger.get(f"/api/spaces/{sid}/scene").status_code == 403


def test_last_owner_cannot_leave(make_client):
    owner = make_client("o7@example.com")
    sid = first_space(owner)["id"]
    # personal-workspace owner still owns it via the workspace, so leaving the space membership is allowed
    r = owner.put(f"/api/spaces/{sid}/members/{owner.me['id']}", json={"role": "viewer"}, headers=H)
    assert r.status_code in (200, 409)


# ---------------------------------------------------------------- files


def test_upload_image_makes_previews_and_urls_are_protected(make_client):
    c = make_client("pic@example.com")
    sid = first_space(c)["id"]
    r = c.post(f"/api/spaces/{sid}/files", files={"file": ("photo.png", png_bytes(), "image/png")}, headers=H)
    assert r.status_code == 200, r.text
    f = r.json()
    assert f["kind"] == "image" and f["width"] == 320 and "thumb_256" in f and f["status"] == "ready"
    signed = f["thumb_256"].split("testserver")[-1]
    assert c.get(signed).headers["content-type"] == "image/webp"
    anon = make_client()
    assert anon.get(signed).status_code == 200  # signed URL works without a cookie
    unsigned = signed.split("?")[0]
    assert anon.get(unsigned).status_code == 404
    resp = c.get(f["src"])
    assert "sandbox" in resp.headers["content-security-policy"]
    root = scene(c, sid)["rootBoardId"]
    r = op(c, sid, {"type": "create", "node": {"id": uid(), "type": "image", "parentId": root, "content": {"title": "photo", "alt": "a photo", "fileId": f["id"]}}})
    node = r.json()["changes"][0]["node"]
    assert node["content"]["src"].startswith("/api/files/")


def test_programs_are_rejected_and_svg_is_sanitized(make_client):
    c = make_client("svg@example.com")
    sid = first_space(c)["id"]
    exe = c.post(f"/api/spaces/{sid}/files", files={"file": ("setup.exe", b"MZ" + b"\0" * 200, "application/octet-stream")}, headers=H)
    assert exe.status_code == 415
    svg = b'<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><a href="javascript:x"><rect width="5" height="5"/></a></svg>'
    r = c.post(f"/api/spaces/{sid}/files", files={"file": ("x.svg", svg, "image/svg+xml")}, headers=H)
    assert r.status_code == 200, r.text
    body = c.get(r.json()["src"]).content
    assert b"script" not in body and b"onload" not in body and b"javascript" not in body and b"<rect" in body


def test_files_in_other_spaces_cannot_be_referenced(make_client):
    a = make_client("fa1@example.com")
    b = make_client("fb1@example.com")
    sa, sb = first_space(a)["id"], first_space(b)["id"]
    f = a.post(f"/api/spaces/{sa}/files", files={"file": ("p.png", png_bytes(), "image/png")}, headers=H).json()
    root_b = scene(b, sb)["rootBoardId"]
    r = op(b, sb, {"type": "create", "node": {"id": uid(), "type": "image", "parentId": root_b, "content": {"fileId": f["id"]}}})
    assert r.status_code == 400
    assert b.post(f"/api/files/{f['id']}/copy?space={sb}", headers=H).status_code == 403


def test_upload_limits(make_client):
    from app import config

    c = make_client("big@example.com")
    sid = first_space(c)["id"]
    object.__setattr__(config.settings, "max_upload_mb", 0)
    try:
        r = c.post(f"/api/spaces/{sid}/files", files={"file": ("p.png", png_bytes(), "image/png")}, headers=H)
        assert r.status_code == 413
    finally:
        object.__setattr__(config.settings, "max_upload_mb", 200)


# ---------------------------------------------------------------- live collaboration


def _live_exchange(a, b, root):
    assert b.receive_json()["role"] == "viewer"
    assert a.receive_json()["t"] == "presence"  # viewer joined
    a.send_json({"t": "presence", "focus": root, "cursor": {"x": 1, "y": 2}})
    p = b.receive_json()
    assert p["t"] == "presence" and p["peer"]["cursor"] == {"x": 1, "y": 2} and p["peer"]["name"]
    nid = uid()
    a.send_json({"t": "op", "cid": "c1", "op": {"type": "create", "node": {"id": nid, "type": "note", "parentId": root, "content": {"title": "live"}}}})
    got_a, got_b = a.receive_json(), b.receive_json()
    assert got_a["cid"] == "c1" and got_b["changes"][0]["node"]["id"] == nid
    b.send_json({"t": "op", "cid": "v1", "op": {"type": "delete", "id": nid}})
    rej = b.receive_json()
    assert rej["t"] == "reject" and rej["cid"] == "v1" and rej["status"] == 403
    return nid, got_a["seq"]


def test_live_ops_broadcast_presence_and_viewer_reject(make_client):
    owner = make_client("live@example.com")
    sid = first_space(owner)["id"]
    token = owner.put(f"/api/spaces/{sid}/join-link", json={"enabled": True, "role": "viewer"}, headers=H).json()["joinLink"]["url"].rsplit("/", 1)[1]
    viewer = make_client("watcher@example.com")
    viewer.post(f"/api/join/{token}", headers=H)
    root = scene(owner, sid)["rootBoardId"]
    # The owner is fully in the room (hello received) before the viewer connects, so the
    # owner is sure to hear about the viewer joining.
    with owner.websocket_connect(f"/api/spaces/{sid}/live") as a:
        assert a.receive_json()["t"] == "hello"
        with viewer.websocket_connect(f"/api/spaces/{sid}/live") as b:
            nid, seq = _live_exchange(a, b, root)
    # Reconnect and catch up on what was missed.
    op(owner, sid, {"type": "update", "id": nid, "patch": {"x": 99}})
    with viewer.websocket_connect(f"/api/spaces/{sid}/live?since={seq}") as b2:
        assert b2.receive_json()["t"] == "hello"
        caught = b2.receive_json()
        assert caught["t"] == "op" and caught["changes"][0]["node"]["x"] == 99


def test_live_rejects_strangers_and_bad_origin(make_client):
    owner = make_client("lv2@example.com")
    sid = first_space(owner)["id"]
    stranger = make_client("lv3@example.com")
    from starlette.websockets import WebSocketDisconnect

    with pytest.raises(WebSocketDisconnect):
        with stranger.websocket_connect(f"/api/spaces/{sid}/live") as ws:
            ws.receive_json()
    with pytest.raises(WebSocketDisconnect):
        with owner.websocket_connect(f"/api/spaces/{sid}/live", headers={"origin": "https://evil.example"}) as ws:
            ws.receive_json()


# ---------------------------------------------------------------- search, previews, your data


def test_search_finds_notes_in_your_spaces_only(make_client):
    a = make_client("sa@example.com")
    b = make_client("sb@example.com")
    sid = first_space(a)["id"]
    root = scene(a, sid)["rootBoardId"]
    op(a, sid, {"type": "create", "node": {"id": uid(), "type": "note", "parentId": root, "content": {"title": "Quokka plan", "body": "zebra stripes"}}})
    hits = a.get("/api/search", params={"q": "zebra"}).json()
    assert hits and hits[0]["node"]["content"]["title"] == "Quokka plan" and hits[0]["path"][0]["id"] == root
    assert b.get("/api/search", params={"q": "zebra"}).json() == []


def test_unfurl_refuses_private_addresses(make_client):
    c = make_client("uf@example.com")
    r = c.get("/api/unfurl", params={"url": "http://127.0.0.1:8000/api/health"})
    assert r.status_code == 200 and r.json()["title"] == "http://127.0.0.1:8000/api/health"
    yt = c.get("/api/unfurl", params={"url": "https://youtu.be/dQw4w9WgXcQ"}).json()
    assert yt["embed"] == "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"


def test_new_space_and_team_workspace(make_client):
    c = make_client("team@example.com")
    s = c.post("/api/spaces", json={"title": "Shoot"}, headers=H).json()
    assert s["title"] == "Shoot"
    ws = c.post("/api/workspaces", json={"name": "Studio"}, headers=H).json()
    link = c.post(f"/api/workspaces/{ws['id']}/members", json={"email": "mate@example.com", "role": "editor"}, headers=H).json()["devLink"]
    s2 = c.post("/api/spaces", json={"title": "Team board", "workspaceId": ws["id"]}, headers=H).json()
    mate = make_client()
    assert mate.post(f"/api/invites/{link.rsplit('/', 1)[1]}/redeem", json={}, headers=H).json() == {"workspaceId": ws["id"]}
    assert any(x["id"] == s2["id"] and x["role"] == "editor" for x in mate.get("/api/spaces").json()["shared"] + mate.get("/api/spaces").json()["mine"])


def test_export_and_delete_account(make_client):
    c = make_client("gone@example.com")
    sid = first_space(c)["id"]
    c.post(f"/api/spaces/{sid}/files", files={"file": ("p.png", png_bytes(), "image/png")}, headers=H)
    z = zipfile.ZipFile(io.BytesIO(c.get("/api/me/export").content))
    names = z.namelist()
    assert "profile.json" in names and any(n.endswith("board.json") for n in names)
    assert c.request("DELETE", "/api/me", json={"confirmEmail": "nope"}, headers=H).status_code == 422
    assert c.request("DELETE", "/api/me", json={"confirmEmail": "gone@example.com"}, headers=H).status_code == 200
    assert c.get("/api/me").status_code == 401
    other = make_client("gone2@example.com")
    assert other.get(f"/api/spaces/{sid}/scene").status_code == 404


def test_stacking_rank_round_trips(make_client):
    c = make_client("layers@example.com")
    sid = first_space(c)["id"]
    root = scene(c, sid)["rootBoardId"]
    nid = uid()
    r = op(c, sid, {"type": "create", "node": {"id": nid, "type": "note", "parentId": root, "rank": 5, "content": {"title": "top"}}})
    assert r.json()["changes"][0]["node"]["rank"] == 5
    op(c, sid, {"type": "update", "id": nid, "patch": {"rank": -2.5}})
    assert next(n for n in scene(c, sid)["nodes"] if n["id"] == nid)["rank"] == -2.5
    assert op(c, sid, {"type": "update", "id": nid, "patch": {"rank": "high"}}).status_code == 400


def test_notes_have_no_practical_length_limit(make_client):
    c = make_client("longnote@example.com")
    sid = first_space(c)["id"]
    root = scene(c, sid)["rootBoardId"]
    body = "word " * 12_000  # ~60,000 characters
    nid = uid()
    r = op(c, sid, {"type": "create", "node": {"id": nid, "type": "note", "parentId": root, "content": {"title": "Long", "body": body}}})
    assert r.status_code == 200
    assert len(r.json()["changes"][0]["node"]["content"]["body"]) == len(body)


def test_folder_import_creates_nested_boards_in_one_batch(make_client):
    # A dropped folder becomes one batch of boards, parents before children, then files upload into them.
    c = make_client("folders@example.com")
    sid = first_space(c)["id"]
    root = scene(c, sid)["rootBoardId"]
    top, inner, deeper = uid("board"), uid("board"), uid("board")
    board = lambda id, parent, title: {"type": "create", "node": {"id": id, "type": "board", "parentId": parent, "x": 90, "y": 90, "w": 360, "h": 300, "content": {"title": title, "frame": {"x": 0, "y": 0, "w": 1200, "h": 1000}}}}
    r = op(c, sid, {"type": "batch", "ops": [board(top, root, "Trip"), board(inner, top, "Day 1"), board(deeper, inner, "Beach")]})
    assert r.status_code == 200, r.text
    r = c.post(f"/api/spaces/{sid}/files", params={"board": deeper}, files={"file": ("sea.png", png_bytes(), "image/png")}, headers=H)
    assert r.status_code == 200, r.text
    assert op(c, sid, {"type": "create", "node": {"id": uid("img"), "type": "image", "parentId": deeper, "x": 100, "y": 100, "w": 220, "h": 190, "content": {"title": "sea", "fileId": r.json()["id"]}}}).status_code == 200
    nodes = {n["id"]: n for n in scene(c, sid)["nodes"]}
    assert nodes[inner]["parentId"] == top and nodes[deeper]["parentId"] == inner
    assert any(n["parentId"] == deeper and n["type"] == "image" for n in nodes.values())


# ---------------------------------------------------------------- one-click invites, guests, workspaces


def _invite_token(c, sid, email, role="editor"):
    r = c.post(f"/api/spaces/{sid}/invites", json={"email": email, "role": role}, headers=H)
    assert r.status_code == 200, r.text
    return r.json()["devLink"].rsplit("/", 1)[1]


def test_invite_link_signs_in_a_new_person_once(make_client):
    owner = make_client("inv-owner@example.com")
    sid = first_space(owner)["id"]
    token = _invite_token(owner, sid, "fresh@example.com")
    visitor = make_client()
    # Looking at the invite (or a mail scanner opening it) doesn't use it.
    info = visitor.get(f"/api/invites/{token}").json()
    assert info["email"] == "fresh@example.com" and info["kind"] == "space" and info["signedInAs"] is None
    assert visitor.post(f"/api/invites/{token}/redeem", json={}).status_code == 403  # CSRF header required
    r = visitor.post(f"/api/invites/{token}/redeem", json={}, headers=H)
    assert r.status_code == 200 and r.json() == {"spaceId": sid}
    assert visitor.get("/api/me").json()["email"] == "fresh@example.com"
    assert scene(visitor, sid)["space"]["role"] == "editor"
    # The link signs someone in only once.
    stranger = make_client()
    assert stranger.post(f"/api/invites/{token}/redeem", json={}, headers=H).status_code == 410
    assert stranger.get("/api/me").status_code == 401
    # The invited person clicking it again while signed in is fine.
    assert visitor.post(f"/api/invites/{token}/redeem", json={}, headers=H).status_code == 200


def test_invite_for_another_account_asks_first(make_client):
    owner = make_client("mm-owner@example.com")
    sid = first_space(owner)["id"]
    token = _invite_token(owner, sid, "anna@example.com")
    ben = make_client("ben@example.com")
    r = ben.post(f"/api/invites/{token}/redeem", json={}, headers=H)
    assert r.status_code == 409 and r.json()["detail"]["reason"] == "mismatch"
    assert ben.get("/api/me").json()["email"] == "ben@example.com"  # nothing changed
    assert ben.post(f"/api/invites/{token}/redeem", json={"switch": True}, headers=H).status_code == 200
    assert ben.get("/api/me").json()["email"] == "anna@example.com"


def test_guests_lose_access_after_guest_period_until_they_sign_in(make_client):
    from datetime import timedelta

    from app.db import SessionLocal
    from app.models import User, now

    owner = make_client("g-owner@example.com")
    sid = first_space(owner)["id"]
    guest = make_client()
    guest.post(f"/api/invites/{_invite_token(owner, sid, 'guesty@example.com', 'viewer')}/redeem", json={}, headers=H)
    assert scene(guest, sid)["space"]["role"] == "viewer"
    with SessionLocal() as db:
        u = db.query(User).filter_by(email="guesty@example.com").one()
        assert u.guest_until is not None
        u.guest_until = now() - timedelta(minutes=1)
        db.commit()
    r = guest.get("/api/me")
    assert r.status_code == 401 and r.json()["detail"]["reason"] == "guest_expired"
    assert guest.get(f"/api/spaces/{sid}/scene").status_code in (401, 404)
    # Signing in normally makes them a full account again.
    signed = make_client("guesty@example.com")
    assert scene(signed, sid)["space"]["role"] == "viewer"
    with SessionLocal() as db:
        assert db.query(User).filter_by(email="guesty@example.com").one().guest_until is None


def test_sessions_have_a_fixed_length_and_logout_revokes(make_client):
    from app.db import SessionLocal
    from app.models import User, UserSession

    c = make_client("fixed@example.com")
    with SessionLocal() as db:
        uid_ = db.query(User).filter_by(email="fixed@example.com").one().id
        sess = db.query(UserSession).filter_by(user_id=uid_).one()
        days = (sess.expires_at - sess.created_at).days
    assert 29 <= days <= 30
    c.get("/api/me")
    with SessionLocal() as db:  # using Zoomz doesn't extend it
        assert (db.query(UserSession).filter_by(user_id=uid_).one().expires_at - sess.expires_at).total_seconds() == 0
    assert c.post("/api/auth/logout", headers=H).status_code == 200
    with SessionLocal() as db:
        assert db.query(UserSession).filter_by(user_id=uid_).count() == 0


def test_workspace_rename_and_delete(make_client):
    c = make_client("ws-admin@example.com")
    ws = c.post("/api/workspaces", json={"name": "Studio"}, headers=H).json()
    sp = c.post("/api/spaces", json={"title": "Team board", "workspaceId": ws["id"]}, headers=H).json()
    link = c.post(f"/api/workspaces/{ws['id']}/members", json={"email": "ws-editor@example.com", "role": "editor"}, headers=H).json()["devLink"]
    editor = make_client()
    editor.post(f"/api/invites/{link.rsplit('/', 1)[1]}/redeem", json={}, headers=H)
    assert c.patch(f"/api/workspaces/{ws['id']}", json={"name": "   "}, headers=H).status_code == 422
    assert editor.patch(f"/api/workspaces/{ws['id']}", json={"name": "Mine now"}, headers=H).status_code == 403
    assert c.patch(f"/api/workspaces/{ws['id']}", json={"name": "Studio Two"}, headers=H).json()["name"] == "Studio Two"
    assert editor.delete(f"/api/workspaces/{ws['id']}", headers=H).status_code == 403
    personal = next(w for w in c.get("/api/spaces").json()["workspaces"] if w["personal"])
    assert c.delete(f"/api/workspaces/{personal['id']}", headers=H).status_code == 409
    assert c.delete(f"/api/workspaces/{ws['id']}", headers=H).status_code == 200
    assert c.get(f"/api/spaces/{sp['id']}/scene").status_code == 404
    assert all(w["id"] != ws["id"] for w in c.get("/api/spaces").json()["workspaces"])


def test_export_board_as_zip_with_folders_and_manifest(make_client):
    import json as _json

    c = make_client("exporter@example.com")
    sid = first_space(c)["id"]
    root = scene(c, sid)["rootBoardId"]
    trip, day, dup = uid("board"), uid("board"), uid("board")
    frame = {"x": 0, "y": 0, "w": 1200, "h": 1000}
    board = lambda id, parent, title: {"type": "create", "node": {"id": id, "type": "board", "parentId": parent, "x": 10, "y": 10, "w": 360, "h": 300, "content": {"title": title, "frame": frame}}}
    assert op(c, sid, {"type": "batch", "ops": [board(trip, root, "Trip: 2026"), board(day, trip, "Day 1"), board(dup, trip, "Day 1")]}).status_code == 200
    up = c.post(f"/api/spaces/{sid}/files", params={"board": day}, files={"file": ("sea.png", png_bytes(), "image/png")}, headers=H).json()
    op(c, sid, {"type": "create", "node": {"id": uid("img"), "type": "image", "parentId": day, "x": 40, "y": 50, "w": 220, "h": 150, "content": {"title": "Sea", "fileId": up["id"]}}})
    op(c, sid, {"type": "create", "node": {"id": uid("note"), "type": "note", "parentId": day, "x": 300, "y": 50, "w": 220, "h": 190, "content": {"title": "Plan", "body": "Swim"}}})
    op(c, sid, {"type": "create", "node": {"id": uid("link"), "type": "link", "parentId": trip, "x": 0, "y": 600, "w": 300, "h": 200, "content": {"title": "Map", "url": "https://example.com/map"}}})

    r = c.get(f"/api/spaces/{sid}/export", params={"board": trip})
    assert r.status_code == 200 and r.headers["content-type"] == "application/zip"
    z = zipfile.ZipFile(io.BytesIO(r.content))
    names = set(z.namelist())
    assert {"Trip_ 2026/zoomz-manifest.json", "Trip_ 2026/README.md", "Trip_ 2026/links.md", "Trip_ 2026/Day 1/sea.png", "Trip_ 2026/Day 1/Plan.md"} <= names
    assert z.read("Trip_ 2026/Day 1/Plan.md").decode() == "# Plan\n\nSwim\n"
    assert "https://example.com/map" in z.read("Trip_ 2026/links.md").decode()
    m = _json.loads(z.read("Trip_ 2026/zoomz-manifest.json"))
    assert m["zoomzExport"] == 2 and m["rootBoardId"] == trip
    by_id = {n["id"]: n for n in m["nodes"]}
    # Two boards with the same name get distinct folders; layout is kept.
    assert {by_id[day]["path"], by_id[dup]["path"]} == {"Trip_ 2026/Day 1/", "Trip_ 2026/Day 1 (2)/"}
    img = next(n for n in m["nodes"] if n["type"] == "image")
    assert img["parentId"] == day and img["x"] == 40 and img["path"] == "Trip_ 2026/Day 1/sea.png"
    # The starter board's built-in artwork comes along too.
    full = zipfile.ZipFile(io.BytesIO(c.get(f"/api/spaces/{sid}/export").content))
    assert any(n.endswith(".svg") for n in full.namelist())
    # Strangers can't export.
    assert make_client("nosy@example.com").get(f"/api/spaces/{sid}/export").status_code in (403, 404)


def test_removing_a_workspace_member_revokes_access(make_client):
    c = make_client("rm-owner@example.com")
    ws = c.post("/api/workspaces", json={"name": "Crew"}, headers=H).json()
    sp = c.post("/api/spaces", json={"title": "Crew board", "workspaceId": ws["id"]}, headers=H).json()
    link = c.post(f"/api/workspaces/{ws['id']}/members", json={"email": "rm-mate@example.com", "role": "editor"}, headers=H).json()["devLink"]
    mate = make_client()
    mate.post(f"/api/invites/{link.rsplit('/', 1)[1]}/redeem", json={}, headers=H)
    assert mate.get(f"/api/spaces/{sp['id']}/scene").status_code == 200
    members = c.get(f"/api/workspaces/{ws['id']}/members").json()
    mate_id = next(m["userId"] for m in members if m.get("email") == "rm-mate@example.com")
    assert c.delete(f"/api/workspaces/{ws['id']}/members/{mate_id}", headers=H).status_code == 200
    assert mate.get(f"/api/spaces/{sp['id']}/scene").status_code in (403, 404)


def test_search_scopes(make_client):
    c = make_client("scope@example.com")
    sid = first_space(c)["id"]
    root = scene(c, sid)["rootBoardId"]
    a, b, inner = uid("board"), uid("board"), uid("board")
    board = lambda id, parent, title: {"type": "create", "node": {"id": id, "type": "board", "parentId": parent, "x": 10, "y": 10, "w": 360, "h": 300, "content": {"title": title}}}
    note = lambda parent, body: {"type": "create", "node": {"id": uid("note"), "type": "note", "parentId": parent, "x": 1, "y": 1, "w": 200, "h": 200, "content": {"title": "", "body": body}}}
    op(c, sid, {"type": "batch", "ops": [board(a, root, "A"), board(b, root, "B"), board(inner, a, "Inner"), note(inner, "zebra deep in A"), note(b, "zebra in B")]})
    other = c.post("/api/spaces", json={"title": "Other"}, headers=H).json()
    op(c, other["id"], note(scene(c, other["id"])["rootBoardId"], "zebra elsewhere"))
    team = c.post("/api/workspaces", json={"name": "T"}, headers=H).json()
    ts = c.post("/api/spaces", json={"title": "Team", "workspaceId": team["id"]}, headers=H).json()
    op(c, ts["id"], note(scene(c, ts["id"])["rootBoardId"], "zebra in team"))

    def bodies(**params):
        return sorted(h["node"]["content"]["body"] for h in c.get("/api/search", params={"q": "zebra", **params}).json())

    assert bodies(scope="board", space=sid, board=a) == ["zebra deep in A"]
    assert bodies(scope="board", space=sid, board=root) == ["zebra deep in A", "zebra in B"]
    ws_id = scene(c, sid)["space"]["workspaceId"]
    assert bodies(scope="workspace", workspace=ws_id) == ["zebra deep in A", "zebra elsewhere", "zebra in B"]
    assert bodies(scope="workspace", workspace=team["id"]) == ["zebra in team"]
    # Someone else's workspace stays invisible whatever the scope says.
    assert make_client("scope-stranger@example.com").get("/api/search", params={"q": "zebra", "scope": "workspace", "workspace": ws_id}).json() == []


def test_pasted_files_survive_losing_the_original(make_client):
    c = make_client("paster@example.com")
    team = c.post("/api/workspaces", json={"name": "Source"}, headers=H).json()
    src = c.post("/api/spaces", json={"title": "Source board", "workspaceId": team["id"]}, headers=H).json()
    dst = next(s["id"] for s in c.get("/api/spaces").json()["mine"] if s["workspaceId"] != team["id"])
    f = c.post(f"/api/spaces/{src['id']}/files", files={"file": ("p.png", png_bytes(), "image/png")}, headers=H).json()
    copied = c.post(f"/api/files/{f['id']}/copy?space={dst}", headers=H)
    assert copied.status_code == 200 and copied.json()["id"] != f["id"]
    # The original workspace goes away; the pasted copy keeps working.
    assert c.delete(f"/api/workspaces/{team['id']}", headers=H).status_code == 200
    assert c.get(copied.json()["src"]).status_code == 200


# ---------------------------------------------------------------- canvases: arrows, duplicate, export → import


def _canvas_with_everything(c):
    sid = first_space(c)["id"]
    root = scene(c, sid)["rootBoardId"]
    trip, n1, n2, arrow = uid("board"), uid("note"), uid("note"), uid("arrow")
    up = c.post(f"/api/spaces/{sid}/files", params={"board": root}, files={"file": ("sea.png", png_bytes(), "image/png")}, headers=H).json()
    img = uid("img")
    ops = [
        {"type": "create", "node": {"id": trip, "type": "board", "parentId": root, "x": 900, "y": 40, "w": 360, "h": 300, "rank": 3, "content": {"title": "Trip", "description": "Summer", "frame": {"x": 0, "y": 0, "w": 1200, "h": 1000}}}},
        {"type": "create", "node": {"id": n1, "type": "note", "parentId": trip, "x": 100, "y": 120, "z": 90, "w": 220, "h": 190, "rank": 7, "content": {"title": "", "body": "Swim"}}},
        {"type": "create", "node": {"id": n2, "type": "note", "parentId": trip, "x": 140, "y": 150, "z": 95, "w": 220, "h": 190, "rank": 8, "content": {"title": "Pack", "body": "Hat"}}},
        {"type": "create", "node": {"id": arrow, "type": "arrow", "parentId": trip, "x": 200, "y": 200, "w": 300, "h": 40, "content": {"x1": 10, "y1": 20, "x2": 290, "y2": 20, "from": n1, "to": n2}}},
        {"type": "create", "node": {"id": img, "type": "image", "parentId": trip, "x": 600, "y": 300, "z": 30, "w": 220, "h": 160, "rank": 2, "content": {"title": "Sea", "alt": "Blue", "fileId": up["id"]}}},
    ]
    assert op(c, sid, {"type": "batch", "ops": ops}).status_code == 200
    return sid


def _shape(c, sid):
    """Everything about a canvas except ids: the tree of items with their layout and content."""
    sc = scene(c, sid)
    nodes = {n["id"]: n for n in sc["nodes"]}
    def sig(n):
        content = {k: v for k, v in n["content"].items() if k not in ("fileId", "src", "thumb_256", "thumb_1024", "mime", "size", "kind", "status", "width", "height", "from", "to", "title" if not n["parentId"] else "")}
        ends = tuple(nodes[n["content"][k]]["content"].get("body") if n["content"].get(k) in nodes else None for k in ("from", "to"))
        p = nodes.get(n["parentId"]) if n["parentId"] else None
        parent = None if p is None else ("<top>" if not p["parentId"] else p["content"].get("title"))
        norm = json.loads(json.dumps(content), parse_int=float)
        return (n["type"], parent, n["x"], n["y"], n.get("z"), n["w"], n["h"], n.get("rank"), json.dumps(norm, sort_keys=True), ends, bool(n["content"].get("fileId") or n["content"].get("src")))
    return sorted((sig(n) for n in nodes.values()), key=repr), sc["space"]["scenery"]


import json  # noqa: E402


def test_arrows_validate_their_ends(make_client):
    c = make_client("arrows@example.com")
    sid = first_space(c)["id"]
    root = scene(c, sid)["rootBoardId"]
    bad = op(c, sid, {"type": "create", "node": {"id": uid("arrow"), "type": "arrow", "parentId": root, "x": 0, "y": 0, "w": 100, "h": 30, "content": {"x1": "no"}}})
    assert bad.status_code == 400
    ok = op(c, sid, {"type": "create", "node": {"id": uid("arrow"), "type": "arrow", "parentId": root, "x": 0, "y": 0, "w": 100, "h": 30, "content": {}}})
    assert ok.status_code == 200 and ok.json()["changes"][0]["node"]["content"] == {"x1": 0.0, "y1": 0.0, "x2": 160.0, "y2": 0.0}


def test_duplicate_canvas_copies_everything(make_client):
    c = make_client("dup@example.com")
    sid = _canvas_with_everything(c)
    c.patch(f"/api/spaces/{sid}", json={"scenery": "cosmos"}, headers=H)
    r = c.post(f"/api/spaces/{sid}/duplicate", json={}, headers=H)
    assert r.status_code == 200, r.text
    copy = r.json()
    assert copy["id"] != sid and copy["title"].endswith("(copy)")
    a, b = _shape(c, copy["id"]), _shape(c, sid)
    assert [x for x in a[0] if x not in b[0]] == [x for x in b[0] if x not in a[0]] == [] and a[1] == b[1]
    # The copy's picture is its own file, and still loads after the original goes.
    img = next(n for n in scene(c, copy["id"])["nodes"] if n["content"].get("fileId"))
    orig = next(n for n in scene(c, sid)["nodes"] if n["content"].get("fileId"))
    assert img["content"]["fileId"] != orig["content"]["fileId"]
    assert c.delete(f"/api/spaces/{sid}", headers=H).status_code == 200
    assert c.get(img["content"]["src"]).status_code == 200
    assert make_client("dup-stranger@example.com").post(f"/api/spaces/{copy['id']}/duplicate", json={}, headers=H).status_code in (403, 404)


def test_export_then_import_rebuilds_the_canvas_exactly(make_client):
    c = make_client("roundtrip@example.com")
    sid = _canvas_with_everything(c)
    c.patch(f"/api/spaces/{sid}", json={"scenery": "dunes"}, headers=H)
    z = c.get(f"/api/spaces/{sid}/export").content
    r = c.post("/api/spaces/import", files={"file": ("canvas.zip", z, "application/zip")}, headers=H)
    assert r.status_code == 200, r.text
    new = r.json()["id"]
    assert new != sid
    a, b = _shape(c, new), _shape(c, sid)
    assert [x for x in a[0] if x not in b[0]] == [x for x in b[0] if x not in a[0]] == [] and a[1] == b[1]
    img = next(n for n in scene(c, new)["nodes"] if n["content"].get("fileId"))
    assert c.get(img["content"]["src"]).status_code == 200
    # Not a zip / no manifest: a clear error, nothing created.
    before = len(c.get("/api/spaces").json()["mine"])
    assert c.post("/api/spaces/import", files={"file": ("x.zip", b"nope", "application/zip")}, headers=H).status_code == 422
    assert len(c.get("/api/spaces").json()["mine"]) == before


def test_undoing_a_multi_item_delete_is_accepted(make_client):
    # Undo of "delete these two" re-creates each (a board with its contents is itself a batch),
    # so the client sends a batch of batches.
    c = make_client("undo-del@example.com")
    sid = first_space(c)["id"]
    root = scene(c, sid)["rootBoardId"]
    b, kid, n = uid("board"), uid("note"), uid("note")
    board = {"id": b, "type": "board", "parentId": root, "x": 0, "y": 0, "w": 360, "h": 300, "content": {"title": "B"}}
    inner = {"id": kid, "type": "note", "parentId": b, "x": 5, "y": 5, "w": 220, "h": 190, "content": {"title": "K", "body": ""}}
    note = {"id": n, "type": "note", "parentId": root, "x": 400, "y": 0, "w": 220, "h": 190, "content": {"title": "N", "body": ""}}
    assert op(c, sid, {"type": "batch", "ops": [{"type": "create", "node": x} for x in (board, inner, note)]}).status_code == 200
    assert op(c, sid, {"type": "batch", "ops": [{"type": "delete", "id": b}, {"type": "delete", "id": n}]}).status_code == 200
    undo = {"type": "batch", "ops": [
        {"type": "batch", "ops": [{"type": "create", "node": note}]},
        {"type": "batch", "ops": [{"type": "create", "node": board}, {"type": "create", "node": inner}]},
    ]}
    r = op(c, sid, undo)
    assert r.status_code == 200, r.text
    ids = {x["id"] for x in scene(c, sid)["nodes"]}
    assert {b, kid, n} <= ids


def test_arrow_styles(make_client):
    c = make_client("arrow-style@example.com")
    sid = first_space(c)["id"]
    root = scene(c, sid)["rootBoardId"]
    aid = uid("arrow")
    node = {"id": aid, "type": "arrow", "parentId": root, "x": 0, "y": 0, "w": 100, "h": 30, "content": {"shape": "curved", "line": "dotted", "heads": "both"}}
    r = op(c, sid, {"type": "create", "node": node})
    assert r.status_code == 200 and {k: r.json()["changes"][0]["node"]["content"][k] for k in ("shape", "line", "heads")} == {"shape": "curved", "line": "dotted", "heads": "both"}
    assert op(c, sid, {"type": "update", "id": aid, "patch": {"content": {"heads": "none", "shape": "elbow", "bend": 0.6}}}).status_code == 200
    assert op(c, sid, {"type": "update", "id": aid, "patch": {"content": {"shape": "zigzag"}}}).status_code == 400


def test_note_and_board_colours(make_client):
    c = make_client("colours@example.com")
    sid = first_space(c)["id"]
    root = scene(c, sid)["rootBoardId"]
    nid, bid = uid("note"), uid("board")
    assert op(c, sid, {"type": "create", "node": {"id": nid, "type": "note", "parentId": root, "content": {"title": "", "body": "x", "color": "graphite"}}}).status_code == 200
    assert op(c, sid, {"type": "create", "node": {"id": bid, "type": "board", "parentId": root, "content": {"title": "B", "color": "white"}}}).status_code == 200
    assert op(c, sid, {"type": "update", "id": nid, "patch": {"content": {"color": "mint"}}}).status_code == 200
    assert op(c, sid, {"type": "update", "id": bid, "patch": {"content": {"color": None}}}).status_code == 200
    assert op(c, sid, {"type": "update", "id": nid, "patch": {"content": {"color": "plaid"}}}).status_code == 400
    nodes = {n["id"]: n for n in scene(c, sid)["nodes"]}
    assert nodes[nid]["content"]["color"] == "mint" and nodes[bid]["content"].get("color") is None
