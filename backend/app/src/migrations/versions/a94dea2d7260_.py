"""empty message

Revision ID: a94dea2d7260
Revises: 5d2b6e168c62
Create Date: 2025-03-01 15:10:24.369093

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "a94dea2d7260"
down_revision: Union[str, None] = "5d2b6e168c62"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ### commands auto generated by Alembic - please adjust! ###
    op.drop_table("analytics")
    # ### end Alembic commands ###


def downgrade() -> None:
    # ### commands auto generated by Alembic - please adjust! ###
    op.create_table(
        "analytics",
        sa.Column("id", sa.BIGINT(), autoincrement=True, nullable=False),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            autoincrement=False,
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            postgresql.TIMESTAMP(timezone=True),
            autoincrement=False,
            nullable=True,
        ),
        sa.Column("player_id", sa.BIGINT(), autoincrement=False, nullable=False),
        sa.Column("team_id", sa.BIGINT(), autoincrement=False, nullable=False),
        sa.Column("tournament_id", sa.BIGINT(), autoincrement=False, nullable=False),
        sa.Column("wins", sa.INTEGER(), autoincrement=False, nullable=False),
        sa.Column("losses", sa.INTEGER(), autoincrement=False, nullable=False),
        sa.Column("shift_one", sa.INTEGER(), autoincrement=False, nullable=True),
        sa.Column("shift_two", sa.INTEGER(), autoincrement=False, nullable=True),
        sa.Column("shift", sa.INTEGER(), autoincrement=False, nullable=True),
        sa.Column(
            "calculated_shift",
            sa.DOUBLE_PRECISION(precision=53),
            autoincrement=False,
            nullable=False,
        ),
        sa.Column(
            "algorithm",
            sa.VARCHAR(),
            server_default=sa.text("'points'::character varying"),
            autoincrement=False,
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["player_id"],
            ["player.id"],
            name="analytics_player_id_fkey",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["team_id"], ["team.id"], name="analytics_team_id_fkey", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["tournament_id"],
            ["tournament.id"],
            name="analytics_tournament_id_fkey",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="analytics_pkey"),
    )
    # ### end Alembic commands ###
