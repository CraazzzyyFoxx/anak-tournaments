"""empty message

Revision ID: 5d2b6e168c62
Revises: 1075af26d847
Create Date: 2025-03-01 14:09:30.255972

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "5d2b6e168c62"
down_revision: Union[str, None] = "1075af26d847"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ### commands auto generated by Alembic - please adjust! ###
    op.add_column(
        "analytics_predictions",
        sa.Column("algorithm_id", sa.BigInteger(), nullable=False),
    )
    op.create_foreign_key(
        None,
        "analytics_predictions",
        "analytics_algorithms",
        ["algorithm_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.add_column("analytics_shifts", sa.Column("shift", sa.Float(), nullable=False))
    op.drop_column("analytics_shifts", "shift_two")
    op.drop_column("analytics_shifts", "losses")
    op.drop_column("analytics_shifts", "wins")
    op.drop_column("analytics_shifts", "calculated_shift")
    op.drop_column("analytics_shifts", "shift_one")
    op.add_column(
        "analytics_tournament", sa.Column("wins", sa.Integer(), nullable=False)
    )
    op.add_column(
        "analytics_tournament", sa.Column("losses", sa.Integer(), nullable=False)
    )
    op.add_column(
        "analytics_tournament", sa.Column("shift_one", sa.Integer(), nullable=True)
    )
    op.add_column(
        "analytics_tournament", sa.Column("shift_two", sa.Integer(), nullable=True)
    )
    # ### end Alembic commands ###


def downgrade() -> None:
    # ### commands auto generated by Alembic - please adjust! ###
    op.drop_column("analytics_tournament", "shift_two")
    op.drop_column("analytics_tournament", "shift_one")
    op.drop_column("analytics_tournament", "losses")
    op.drop_column("analytics_tournament", "wins")
    op.add_column(
        "analytics_shifts",
        sa.Column("shift_one", sa.INTEGER(), autoincrement=False, nullable=True),
    )
    op.add_column(
        "analytics_shifts",
        sa.Column(
            "calculated_shift",
            sa.DOUBLE_PRECISION(precision=53),
            autoincrement=False,
            nullable=False,
        ),
    )
    op.add_column(
        "analytics_shifts",
        sa.Column("wins", sa.INTEGER(), autoincrement=False, nullable=False),
    )
    op.add_column(
        "analytics_shifts",
        sa.Column("losses", sa.INTEGER(), autoincrement=False, nullable=False),
    )
    op.add_column(
        "analytics_shifts",
        sa.Column("shift_two", sa.INTEGER(), autoincrement=False, nullable=True),
    )
    op.drop_column("analytics_shifts", "shift")
    op.drop_constraint(None, "analytics_predictions", type_="foreignkey")
    op.drop_column("analytics_predictions", "algorithm_id")
    # ### end Alembic commands ###
