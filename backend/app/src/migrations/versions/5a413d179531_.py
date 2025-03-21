"""empty message

Revision ID: 5a413d179531
Revises: 8e85bcd266b0
Create Date: 2024-10-28 16:00:54.474411

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "5a413d179531"
down_revision: str | None = "8e85bcd266b0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ### commands auto generated by Alembic - please adjust! ###
    op.create_index(
        op.f("ix_match_statistics_value"), "match_statistics", ["value"], unique=False
    )
    # ### end Alembic commands ###


def downgrade() -> None:
    # ### commands auto generated by Alembic - please adjust! ###
    op.drop_index(op.f("ix_match_statistics_value"), table_name="match_statistics")
    # ### end Alembic commands ###
