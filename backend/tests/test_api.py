import json
import math
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app
from app.models import Scene


FIXTURE = Path(__file__).resolve().parents[1] / "app" / "data" / "demo-board.json"
FRONTEND_PUBLIC = Path(__file__).resolve().parents[2] / "frontend" / "public"
client = TestClient(app)


def test_health() -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_demo_board_matches_fixture_on_repeated_requests() -> None:
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    first = client.get("/api/demo-board")
    second = client.get("/api/demo-board")

    assert first.status_code == second.status_code == 200
    assert first.json() == second.json() == fixture
    assert Scene.model_validate(first.json()).model_dump(exclude_unset=True) == fixture


def test_scene_contract_and_topology() -> None:
    scene = client.get("/api/demo-board").json()
    assert set(scene) == {"rootBoardId", "nodes"}
    nodes = scene["nodes"]
    ids = [node["id"] for node in nodes]
    assert len(ids) == len(set(ids))
    by_id = {node["id"]: node for node in nodes}
    root_id = scene["rootBoardId"]
    assert root_id in by_id
    roots = [node for node in nodes if node["parentId"] is None]
    assert len(roots) == 1
    assert roots[0]["id"] == root_id
    assert roots[0]["type"] == "board"

    images = [node for node in nodes if node["type"] == "image"]
    notes = [node for node in nodes if node["type"] == "note"]
    assert len(images) == 30
    assert len(notes) >= 3

    children: dict[str, list[str]] = {node_id: [] for node_id in ids}
    for node in nodes:
        assert set(node) == {"id", "type", "parentId", "x", "y", "w", "h", "content"}
        assert all(math.isfinite(node[key]) for key in ("x", "y", "w", "h"))
        assert node["w"] > 0 and node["h"] > 0
        if node["id"] != root_id:
            parent = by_id[node["parentId"]]
            assert parent["type"] == "board"
            children[parent["id"]].append(node["id"])

        content = node["content"]
        if node["type"] == "board":
            assert set(content) in ({"title"}, {"title", "description"})
        elif node["type"] == "image":
            assert set(content) == {"title", "src", "alt"}
            assert content["alt"].strip()
            src = content["src"]
            assert src.startswith("/assets/") and ".." not in src
            assert (FRONTEND_PUBLIC / src.lstrip("/")).is_file()
        else:
            assert node["type"] == "note"
            assert set(content) == {"title", "body"}
            assert content["body"].strip()

    visited: set[str] = set()

    def visit(node_id: str, board_depth: int) -> int:
        assert node_id not in visited
        visited.add(node_id)
        node = by_id[node_id]
        if node["type"] == "board":
            board_depth += 1
        return max([board_depth, *(visit(child, board_depth) for child in children[node_id])])

    assert visit(root_id, 0) >= 3
    assert visited == set(ids)
