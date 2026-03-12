"""Add balancer player role entries

Revision ID: 3c7a9d1e4b22
Revises: 2b1f6c7d9e10
Create Date: 2026-03-12 22:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "3c7a9d1e4b22"
down_revision: str | None = "2b1f6c7d9e10"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("player", sa.Column("role_entries_json", sa.JSON(), nullable=True), schema="balancer")
    op.add_column(
        "player",
        sa.Column("is_flex", sa.Boolean(), nullable=False, server_default="false"),
        schema="balancer",
    )

    op.execute(
        """
        UPDATE balancer.player
        SET role_entries_json = CASE
            WHEN primary_role IS NULL THEN '[]'::json
            ELSE (
                jsonb_build_array(
                    jsonb_build_object(
                        'role', primary_role,
                        'priority', 1,
                        'division_number', division_number,
                        'rank_value', rank_value
                    )
                ) || COALESCE(
                    (
                        SELECT jsonb_agg(
                            jsonb_build_object(
                                'role', role_name,
                                'priority', ordinality + 1,
                                'division_number', division_number,
                                'rank_value', rank_value
                            )
                        )
                        FROM jsonb_array_elements_text(COALESCE(secondary_roles_json::jsonb, '[]'::jsonb)) WITH ORDINALITY AS secondary(role_name, ordinality)
                    ),
                    '[]'::jsonb
                )
            )::json
        END,
        is_flex = CASE
            WHEN primary_role IS NULL THEN false
            WHEN rank_value IS NULL THEN false
            WHEN COALESCE(jsonb_array_length(COALESCE(secondary_roles_json::jsonb, '[]'::jsonb)), 0) > 0 THEN true
            ELSE false
        END
        """
    )


def downgrade() -> None:
    op.drop_column("player", "is_flex", schema="balancer")
    op.drop_column("player", "role_entries_json", schema="balancer")
