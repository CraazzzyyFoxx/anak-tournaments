"""empty message

Revision ID: 7de68d5f9982
Revises: e52968b6e022
Create Date: 2025-02-02 19:45:44.681147

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "7de68d5f9982"
down_revision: Union[str, None] = "e52968b6e022"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ### commands auto generated by Alembic - please adjust! ###
    op.add_column(
        "analytics", sa.Column("calculated_shift", sa.Integer(), nullable=False)
    )
    # ### end Alembic commands ###


def downgrade() -> None:
    # ### commands auto generated by Alembic - please adjust! ###
    op.drop_column("analytics", "calculated_shift")
    # ### end Alembic commands ###
