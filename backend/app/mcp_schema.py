"""Bounded provenance and mutation contracts shared by editor and MCP."""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator
from urllib.parse import urlsplit


class SourceReference(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str | None = Field(default=None, max_length=200)
    filename: str | None = Field(default=None, max_length=255)
    asset_id: str | None = Field(default=None, min_length=32, max_length=32)
    page: int | None = Field(default=None, ge=1, le=100000)
    slide: int | None = Field(default=None, ge=1, le=100000)
    section: str | None = Field(default=None, max_length=300)
    excerpt: str | None = Field(default=None, max_length=1000)
    url: str | None = Field(default=None, max_length=2000)
    classification: Literal["source", "supplementary", "external"]
    availability: Literal["available", "missing", "unverified"] = "unverified"

    @field_validator("url")
    @classmethod
    def safe_url(cls, value):
        if value:
            parsed = urlsplit(value)
            if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
                raise ValueError("References need an HTTP(S) URL without credentials")
        return value


class CanvasBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    space_id: str = Field(min_length=1, max_length=32)
    idempotency_key: str = Field(min_length=1, max_length=120)
    expected_revision: int = Field(ge=0)
    operations: list[dict] = Field(min_length=1, max_length=100)
    task_id: str | None = Field(default=None, max_length=32)


class Checkpoint(BaseModel):
    model_config = ConfigDict(extra="forbid")
    completed_phases: list[str] = Field(default_factory=list, max_length=50)
    outstanding_work: str = Field(default="", max_length=8000)
    missing_sources: list[str] = Field(default_factory=list, max_length=100)
    available_sources: list[str] = Field(default_factory=list, max_length=100)
    summary: str = Field(default="", max_length=8000)
