"""guests and workspace invites

Revision ID: a1c4e2f9b7d3
Revises: 7de3a94355d8
Create Date: 2026-10-18 10:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a1c4e2f9b7d3'
down_revision: Union[str, Sequence[str], None] = '7de3a94355d8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('guest_until', sa.DateTime(timezone=True), nullable=True))
    with op.batch_alter_table('invites', schema=None) as batch_op:
        batch_op.add_column(sa.Column('workspace_id', sa.String(length=32), nullable=True))
        batch_op.alter_column('space_id', existing_type=sa.String(length=32), nullable=True)
        batch_op.create_index(batch_op.f('ix_invites_workspace_id'), ['workspace_id'], unique=False)
        batch_op.create_foreign_key('fk_invites_workspace_id_workspaces', 'workspaces', ['workspace_id'], ['id'], ondelete='CASCADE')


def downgrade() -> None:
    op.execute("DELETE FROM invites WHERE space_id IS NULL")
    with op.batch_alter_table('invites', schema=None) as batch_op:
        batch_op.drop_constraint('fk_invites_workspace_id_workspaces', type_='foreignkey')
        batch_op.drop_index(batch_op.f('ix_invites_workspace_id'))
        batch_op.alter_column('space_id', existing_type=sa.String(length=32), nullable=False)
        batch_op.drop_column('workspace_id')
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_column('guest_until')
