"""MCP delegation and generation state."""
from alembic import op
import sqlalchemy as sa

revision = "a90b4a770001"
down_revision = "7de3a94355d8"
branch_labels = depends_on = None


def fk(name, target, nullable=False, delete="CASCADE"):
    return sa.Column(name, sa.String(64 if target == "nodes.id" else 32), sa.ForeignKey(target, ondelete=delete), nullable=nullable)


def ident():
    return sa.Column("id", sa.String(32), primary_key=True)


def upgrade():
    op.create_table("mcp_clients", ident(), sa.Column("name", sa.String(120), nullable=False), sa.Column("redirects", sa.JSON, nullable=False))
    op.create_table("mcp_pending", ident(), sa.Column("payload", sa.JSON, nullable=False), sa.Column("expires", sa.Integer, nullable=False))
    op.create_table("mcp_connections", ident(), fk("user_id", "users.id"), fk("client_id", "mcp_clients.id"), sa.Column("grants", sa.JSON, nullable=False), sa.Column("revoked", sa.Boolean, nullable=False))
    op.create_index("ix_mcp_connections_user_id", "mcp_connections", ["user_id"])
    op.create_table("mcp_credentials", sa.Column("digest", sa.String(64), primary_key=True), fk("connection_id", "mcp_connections.id"), sa.Column("kind", sa.String(12), nullable=False), sa.Column("expires", sa.Integer, nullable=False), sa.Column("used", sa.Boolean, nullable=False), sa.Column("payload", sa.JSON, nullable=False))
    op.create_index("ix_mcp_credentials_connection_id", "mcp_credentials", ["connection_id"])
    op.create_table("mcp_tasks", ident(), fk("user_id", "users.id"), fk("connection_id", "mcp_connections.id"), fk("space_id", "spaces.id"), fk("board_id", "nodes.id"), sa.Column("objective", sa.Text, nullable=False), sa.Column("state", sa.String(16), nullable=False), sa.Column("checkpoint", sa.JSON, nullable=False), sa.Column("updated", sa.Integer, nullable=False))
    op.create_index("ix_mcp_tasks_space_id", "mcp_tasks", ["space_id"])
    op.create_table("mcp_batches", ident(), fk("connection_id", "mcp_connections.id"), sa.Column("key", sa.String(120), nullable=False), sa.Column("digest", sa.String(64), nullable=False), sa.Column("result", sa.JSON, nullable=False), sa.UniqueConstraint("connection_id", "key"))
    op.create_table("mcp_approvals", ident(), fk("connection_id", "mcp_connections.id"), fk("space_id", "spaces.id"), sa.Column("digest", sa.String(64), nullable=False), sa.Column("request", sa.JSON, nullable=False), sa.Column("expires", sa.Integer, nullable=False), sa.Column("approved", sa.Boolean, nullable=False), sa.Column("used", sa.Boolean, nullable=False))
    op.create_index("ix_mcp_approvals_connection_id", "mcp_approvals", ["connection_id"])
    op.create_table("mcp_audit", ident(), fk("user_id", "users.id"), fk("connection_id", "mcp_connections.id", nullable=True, delete="SET NULL"), sa.Column("action", sa.String(40), nullable=False), sa.Column("at", sa.Integer, nullable=False), sa.Column("detail", sa.JSON, nullable=False))
    op.create_index("ix_mcp_audit_user_id", "mcp_audit", ["user_id"])


def downgrade():
    for name in ("mcp_audit", "mcp_approvals", "mcp_batches", "mcp_tasks", "mcp_credentials", "mcp_connections", "mcp_pending", "mcp_clients"):
        op.drop_table(name)
