from collections import Counter

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def scene():
    res = client.get("/api/demo-board")
    assert res.status_code == 200
    return res.json()


def test_health():
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


def test_scene_shape_and_counts():
    data = scene()
    nodes = {n["id"]: n for n in data["nodes"]}
    assert len(nodes) == len(data["nodes"]), "ids must be unique"
    root = nodes[data["rootBoardId"]]
    assert root["type"] == "board" and root["parentId"] is None

    counts = Counter(n["type"] for n in data["nodes"])
    assert 25 <= counts["image"] <= 40
    assert counts["note"] >= 3

    for n in data["nodes"]:
        if n["parentId"] is not None:
            assert nodes[n["parentId"]]["type"] == "board"
        if n["type"] == "image":
            assert n["content"]["alt"]
            assert n["content"]["src"].startswith("/api/assets/")


def test_at_least_three_levels():
    data = scene()
    nodes = {n["id"]: n for n in data["nodes"]}

    def depth(node_id):
        d, cur = 0, nodes[node_id]
        while cur["parentId"] is not None:
            d, cur = d + 1, nodes[cur["parentId"]]
        return d

    assert max(depth(n["id"]) for n in data["nodes"] if n["type"] == "board") >= 2


def test_deterministic():
    assert client.get("/api/demo-board").json() == client.get("/api/demo-board").json()


def test_assets_served():
    src = next(n for n in scene()["nodes"] if n["type"] == "image")["content"]["src"]
    res = client.get(src)
    assert res.status_code == 200
    assert "svg" in res.headers["content-type"]
