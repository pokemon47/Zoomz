from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Geometry(StrictModel):
    id: str = Field(min_length=1)
    parentId: str | None
    x: float = Field(allow_inf_nan=False)
    y: float = Field(allow_inf_nan=False)
    w: float = Field(gt=0, allow_inf_nan=False)
    h: float = Field(gt=0, allow_inf_nan=False)


class BoardContent(StrictModel):
    title: str = Field(min_length=1)
    description: str | None = None


class ImageContent(StrictModel):
    title: str = Field(min_length=1)
    src: str = Field(min_length=1)
    alt: str = Field(min_length=1)


class NoteContent(StrictModel):
    title: str = Field(min_length=1)
    body: str = Field(min_length=1)


class BoardNode(Geometry):
    type: Literal["board"]
    content: BoardContent


class ImageNode(Geometry):
    type: Literal["image"]
    content: ImageContent


class NoteNode(Geometry):
    type: Literal["note"]
    content: NoteContent


Node = Annotated[Union[BoardNode, ImageNode, NoteNode], Field(discriminator="type")]


class Scene(StrictModel):
    rootBoardId: str = Field(min_length=1)
    nodes: list[Node]


class Health(StrictModel):
    status: Literal["ok"]
