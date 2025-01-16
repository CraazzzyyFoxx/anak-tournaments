"""empty message

Revision ID: 6c91bcfa2f7b
Revises: 46d168e75f7c
Create Date: 2024-08-18 21:58:07.251946

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "6c91bcfa2f7b"
down_revision: str | None = "46d168e75f7c"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ### commands auto generated by Alembic - please adjust! ###
    op.add_column("team", sa.Column("balancer_name", sa.String(), nullable=False))
    op.add_column("team", sa.Column("captain_id", sa.BigInteger(), nullable=False))
    op.create_foreign_key(None, "team", "user", ["captain_id"], ["id"])
    # ### end Alembic commands ###


def downgrade() -> None:
    # ### commands auto generated by Alembic - please adjust! ###
    op.drop_constraint(None, "team", type_="foreignkey")
    op.drop_column("team", "captain_id")
    op.drop_column("team", "balancer_name")
    # ### end Alembic commands ###
