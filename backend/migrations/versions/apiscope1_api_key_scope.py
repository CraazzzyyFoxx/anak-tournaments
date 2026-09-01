"""Normalize API-key RBAC scopes into auth.api_key_scope.

Revision ID: apiscope1
Revises: mix3nf03
Create Date: 2026-09-01 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "apiscope1"
down_revision: str | Sequence[str] | None = "mix3nf03"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "api_key_scope",
        sa.Column("api_key_id", sa.BigInteger(), nullable=False),
        sa.Column("scope", sa.String(length=64), nullable=False),
        sa.ForeignKeyConstraint(["api_key_id"], ["auth.api_key.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("api_key_id", "scope"),
        schema="auth",
    )
    op.execute(
        sa.text(
            """
            INSERT INTO auth.api_key_scope (api_key_id, scope)
            SELECT k.id, trim(s.scope)
            FROM auth.api_key k
            CROSS JOIN LATERAL json_array_elements_text(COALESCE(k.scopes_json, '[]'::json)) AS s(scope)
            WHERE trim(s.scope) <> ''
            ON CONFLICT (api_key_id, scope) DO NOTHING
            """
        )
    )
    op.drop_column("api_key", "scopes_json", schema="auth")


def downgrade() -> None:
    op.add_column(
        "api_key",
        sa.Column("scopes_json", sa.JSON(), server_default="[]", nullable=False),
        schema="auth",
    )
    op.execute(
        sa.text(
            """
            UPDATE auth.api_key k
            SET scopes_json = COALESCE((
                SELECT json_agg(s.scope ORDER BY s.scope)
                FROM auth.api_key_scope s
                WHERE s.api_key_id = k.id
            ), '[]'::json)
            """
        )
    )
    op.drop_table("api_key_scope", schema="auth")
