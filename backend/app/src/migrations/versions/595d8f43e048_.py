"""empty message

Revision ID: 595d8f43e048
Revises: 53aedb5ec951
Create Date: 2024-09-01 02:28:00.583672

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "595d8f43e048"
down_revision: str | None = "53aedb5ec951"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ### commands auto generated by Alembic - please adjust! ###
    op.add_column(
        "standing",
        sa.Column("overall_position", sa.Integer(), server_default="0", nullable=False),
    )
    # ### end Alembic commands ###


def downgrade() -> None:
    # ### commands auto generated by Alembic - please adjust! ###
    op.drop_column("standing", "overall_position")
    # ### end Alembic commands ###
