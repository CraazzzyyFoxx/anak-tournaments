"""empty message

Revision ID: 9a49a3beab5b
Revises: c2cc1adb7e9d
Create Date: 2024-09-04 17:37:42.754201

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "9a49a3beab5b"
down_revision: str | None = "c2cc1adb7e9d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ### commands auto generated by Alembic - please adjust! ###
    op.alter_column(
        "match_statistics", "hero_id", existing_type=sa.BIGINT(), nullable=True
    )
    # ### end Alembic commands ###


def downgrade() -> None:
    # ### commands auto generated by Alembic - please adjust! ###
    op.alter_column(
        "match_statistics", "hero_id", existing_type=sa.BIGINT(), nullable=False
    )
    # ### end Alembic commands ###
