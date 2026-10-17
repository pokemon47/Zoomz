"""Zoomable Board demo API.

Serves one read-only, deterministic scene from a checked-in JSON fixture plus
the bundled placeholder artwork. Nothing here writes to disk.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import List, Literal, Optional, Union

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

APP_DIR = Path(__file__).resolve().parent
DATA_FILE = APP_DIR / "data" / "demo-board.json"
STATIC_DIR = APP_DIR / "static"


class BoardContent(BaseModel):
    title: str
    description: Optional[str] = None


class ImageContent(BaseModel):
    title: str
    src: str
    alt: str


class NoteContent(BaseModel):
    title: str
    body: str


class BaseNode(BaseModel):
    id: str
    parentId: Optional[str]
    x: float
    y: float
    w: float
    h: float


class BoardNode(BaseNode):
    type: Literal["board"]
    content: BoardContent


class ImageNode(BaseNode):
    type: Literal["image"]
    content: ImageContent


class NoteNode(BaseNode):
    type: Literal["note"]
    content: NoteContent


class Scene(BaseModel):
    rootBoardId: str
    nodes: List[Union[BoardNode, ImageNode, NoteNode]]


@lru_cache(maxsize=1)
def load_scene() -> Scene:
    return Scene.model_validate(json.loads(DATA_FILE.read_text()))


app = FastAPI(title="Zoomable Board API", version="0.1.0")


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/demo-board", response_model=Scene)
def demo_board() -> Scene:
    return load_scene()


app.mount("/api/assets", StaticFiles(directory=STATIC_DIR), name="assets")
