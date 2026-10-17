"""Persisted delegation, generation, approval, and retry state."""

from typing import Any, Optional
from sqlalchemy import JSON, Boolean, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from .db import Base
from .models import new_id


class McpClient(Base):
    __tablename__ = "mcp_clients"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(120))
    redirects: Mapped[list] = mapped_column(JSON)


class McpPending(Base):
    __tablename__ = "mcp_pending"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    payload: Mapped[dict] = mapped_column(JSON)
    expires: Mapped[int] = mapped_column(Integer)


class McpConnection(Base):
    __tablename__ = "mcp_connections"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    client_id: Mapped[str] = mapped_column(ForeignKey("mcp_clients.id", ondelete="CASCADE"))
    grants: Mapped[dict] = mapped_column(JSON)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)


class McpCredential(Base):
    __tablename__ = "mcp_credentials"
    digest: Mapped[str] = mapped_column(String(64), primary_key=True)
    connection_id: Mapped[str] = mapped_column(ForeignKey("mcp_connections.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(12))
    expires: Mapped[int] = mapped_column(Integer)
    used: Mapped[bool] = mapped_column(Boolean, default=False)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)


class GenerationTask(Base):
    __tablename__ = "mcp_tasks"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    connection_id: Mapped[str] = mapped_column(ForeignKey("mcp_connections.id", ondelete="CASCADE"))
    space_id: Mapped[str] = mapped_column(ForeignKey("spaces.id", ondelete="CASCADE"), index=True)
    board_id: Mapped[str] = mapped_column(String(64), ForeignKey("nodes.id", ondelete="CASCADE"))
    objective: Mapped[str] = mapped_column(Text)
    state: Mapped[str] = mapped_column(String(16), default="created")
    checkpoint: Mapped[dict] = mapped_column(JSON, default=dict)
    updated: Mapped[int] = mapped_column(Integer)


class McpBatch(Base):
    __tablename__ = "mcp_batches"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    connection_id: Mapped[str] = mapped_column(ForeignKey("mcp_connections.id", ondelete="CASCADE"))
    key: Mapped[str] = mapped_column(String(120))
    digest: Mapped[str] = mapped_column(String(64))
    result: Mapped[dict] = mapped_column(JSON)
    __table_args__ = (UniqueConstraint("connection_id", "key"),)


class McpApproval(Base):
    __tablename__ = "mcp_approvals"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    connection_id: Mapped[str] = mapped_column(ForeignKey("mcp_connections.id", ondelete="CASCADE"), index=True)
    space_id: Mapped[str] = mapped_column(ForeignKey("spaces.id", ondelete="CASCADE"))
    digest: Mapped[str] = mapped_column(String(64))
    request: Mapped[dict] = mapped_column(JSON)
    expires: Mapped[int] = mapped_column(Integer)
    approved: Mapped[bool] = mapped_column(Boolean, default=False)
    used: Mapped[bool] = mapped_column(Boolean, default=False)


class McpAudit(Base):
    __tablename__ = "mcp_audit"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    connection_id: Mapped[Optional[str]] = mapped_column(ForeignKey("mcp_connections.id", ondelete="SET NULL"), nullable=True)
    action: Mapped[str] = mapped_column(String(40))
    at: Mapped[int] = mapped_column(Integer)
    detail: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
