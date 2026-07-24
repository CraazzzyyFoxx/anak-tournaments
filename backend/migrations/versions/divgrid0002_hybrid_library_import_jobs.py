"""hybrid division-grid library provenance and import jobs

Revision ID: divgrid0002
Revises: captrep0001
Create Date: 2026-07-24 16:30:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "divgrid0002"
down_revision: str | Sequence[str] | None = "captrep0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("division_grid", sa.Column("source_workspace_id", sa.BigInteger(), nullable=True))
    op.add_column("division_grid", sa.Column("source_grid_id", sa.BigInteger(), nullable=True))
    op.add_column("division_grid", sa.Column("source_fingerprint", sa.String(length=64), nullable=True))
    op.add_column("division_grid", sa.Column("source_key", sa.String(length=255), nullable=True))
    op.add_column("division_grid", sa.Column("imported_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("division_grid", sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True))
    op.create_foreign_key(
        "fk_division_grid_source_workspace",
        "division_grid",
        "workspace",
        ["source_workspace_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_division_grid_source_grid",
        "division_grid",
        "division_grid",
        ["source_grid_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_division_grid_source_workspace_id", "division_grid", ["source_workspace_id"])
    op.create_index("ix_division_grid_source_grid_id", "division_grid", ["source_grid_id"])
    op.create_index("ix_division_grid_source_fingerprint", "division_grid", ["source_fingerprint"])
    op.create_index("ix_division_grid_source_key", "division_grid", ["source_key"])
    op.create_index(
        "uq_division_grid_workspace_source_key_active",
        "division_grid",
        ["workspace_id", "source_key"],
        unique=True,
        postgresql_where=sa.text("source_key IS NOT NULL AND archived_at IS NULL"),
    )

    op.create_table(
        "division_grid_import_job",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("workspace_id", sa.BigInteger(), nullable=False),
        sa.Column("source_workspace_id", sa.BigInteger(), nullable=True),
        sa.Column("requested_by_user_id", sa.BigInteger(), nullable=True),
        sa.Column("status", sa.String(length=16), server_default="pending", nullable=False),
        sa.Column("progress", sa.Integer(), server_default="0", nullable=False),
        sa.Column("request_json", sa.JSON(), nullable=False),
        sa.Column("result_json", sa.JSON(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("idempotency_key", sa.String(length=255), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["source_workspace_id"], ["workspace.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["requested_by_user_id"], ["auth.user.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("workspace_id", "idempotency_key", name="uq_division_grid_import_job_workspace_key"),
    )
    op.create_index("ix_division_grid_import_job_workspace_id", "division_grid_import_job", ["workspace_id"])
    op.create_index(
        "ix_division_grid_import_job_source_workspace_id",
        "division_grid_import_job",
        ["source_workspace_id"],
    )
    op.create_index(
        "ix_division_grid_import_job_requested_by_user_id",
        "division_grid_import_job",
        ["requested_by_user_id"],
    )
    op.create_index("ix_division_grid_import_job_status", "division_grid_import_job", ["status"])


def downgrade() -> None:
    op.drop_index("ix_division_grid_import_job_status", table_name="division_grid_import_job")
    op.drop_index("ix_division_grid_import_job_requested_by_user_id", table_name="division_grid_import_job")
    op.drop_index("ix_division_grid_import_job_source_workspace_id", table_name="division_grid_import_job")
    op.drop_index("ix_division_grid_import_job_workspace_id", table_name="division_grid_import_job")
    op.drop_table("division_grid_import_job")
    op.drop_index("uq_division_grid_workspace_source_key_active", table_name="division_grid")
    op.drop_index("ix_division_grid_source_key", table_name="division_grid")

    op.drop_index("ix_division_grid_source_fingerprint", table_name="division_grid")
    op.drop_index("ix_division_grid_source_grid_id", table_name="division_grid")
    op.drop_index("ix_division_grid_source_workspace_id", table_name="division_grid")
    op.drop_constraint("fk_division_grid_source_grid", "division_grid", type_="foreignkey")
    op.drop_constraint("fk_division_grid_source_workspace", "division_grid", type_="foreignkey")
    op.drop_column("division_grid", "archived_at")
    op.drop_column("division_grid", "imported_at")
    op.drop_column("division_grid", "source_key")
    op.drop_column("division_grid", "source_fingerprint")
    op.drop_column("division_grid", "source_grid_id")
    op.drop_column("division_grid", "source_workspace_id")
