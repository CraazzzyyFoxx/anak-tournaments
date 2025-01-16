"""empty message

Revision ID: a0eb19c3b7ee
Revises: 0b45b61f373b
Create Date: 2024-10-14 20:49:44.993170

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a0eb19c3b7ee"
down_revision: str | None = "0b45b61f373b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ### commands auto generated by Alembic - please adjust! ###
    op.drop_column("tournament_group", "is_playoffs")
    # ### end Alembic commands ###


def downgrade() -> None:
    # ### commands auto generated by Alembic - please adjust! ###
    op.add_column(
        "tournament_group",
        sa.Column("is_playoffs", sa.BOOLEAN(), autoincrement=False, nullable=False),
    )
    # ### end Alembic commands ###
