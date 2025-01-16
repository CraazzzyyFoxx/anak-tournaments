"""empty message

Revision ID: c2cc1adb7e9d
Revises: 595d8f43e048
Create Date: 2024-09-04 15:53:36.927490

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c2cc1adb7e9d"
down_revision: str | None = "595d8f43e048"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ### commands auto generated by Alembic - please adjust! ###
    op.add_column("encounter", sa.Column("has_logs", sa.Boolean(), nullable=False))
    op.create_index(
        op.f("ix_match_statistics_hero_id"),
        "match_statistics",
        ["hero_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_match_statistics_user_id"),
        "match_statistics",
        ["user_id"],
        unique=False,
    )
    op.add_column(
        "player",
        sa.Column("is_newcomer", sa.Boolean(), server_default="false", nullable=False),
    )
    op.add_column(
        "player",
        sa.Column(
            "is_newcomer_role", sa.Boolean(), server_default="false", nullable=False
        ),
    )
    # ### end Alembic commands ###


def downgrade() -> None:
    # ### commands auto generated by Alembic - please adjust! ###
    op.drop_column("player", "is_newcomer_role")
    op.drop_column("player", "is_newcomer")
    op.drop_index(op.f("ix_match_statistics_user_id"), table_name="match_statistics")
    op.drop_index(op.f("ix_match_statistics_hero_id"), table_name="match_statistics")
    op.drop_column("encounter", "has_logs")
    # ### end Alembic commands ###
