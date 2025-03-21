"""empty message

Revision ID: 77a777444a13
Revises: f7fe195a753d
Create Date: 2024-08-19 00:28:59.121144

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "77a777444a13"
down_revision: str | None = "f7fe195a753d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ### commands auto generated by Alembic - please adjust! ###
    op.create_table(
        "encounter",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("home_team_id", sa.BigInteger(), nullable=False),
        sa.Column("away_team_id", sa.BigInteger(), nullable=False),
        sa.Column("home_score", sa.Integer(), nullable=False),
        sa.Column("away_score", sa.Integer(), nullable=False),
        sa.Column("round", sa.Integer(), nullable=False),
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.Column("tournament_group_id", sa.BigInteger(), nullable=False),
        sa.Column("challonge_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["away_team_id"], ["team.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["home_team_id"], ["team.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["tournament_group_id"], ["tournament_group.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["tournament_id"], ["tournament.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    # ### end Alembic commands ###


def downgrade() -> None:
    # ### commands auto generated by Alembic - please adjust! ###
    op.drop_table("encounter")
    # ### end Alembic commands ###
