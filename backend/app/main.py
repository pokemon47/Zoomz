from pathlib import Path

from fastapi import FastAPI

from app.models import Health, Scene


app = FastAPI(title="Zoomz API")
_SCENE_PATH = Path(__file__).resolve().parent / "data" / "demo-board.json"
_SCENE = Scene.model_validate_json(_SCENE_PATH.read_text(encoding="utf-8"))


@app.get("/api/health")
def health() -> Health:
    return Health(status="ok")


@app.get("/api/demo-board", response_model_exclude_unset=True)
def demo_board() -> Scene:
    return _SCENE
