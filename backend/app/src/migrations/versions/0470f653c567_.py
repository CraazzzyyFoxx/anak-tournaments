"""empty message

Revision ID: 0470f653c567
Revises: dcc41cd48cc1
Create Date: 2024-08-21 23:15:18.677163

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0470f653c567"
down_revision: str | None = "dcc41cd48cc1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ### commands auto generated by Alembic - please adjust! ###
    op.drop_constraint(
        "standing_tournament_id_group_id_key", "standing", type_="unique"
    )
    # ### end Alembic commands ###


def downgrade() -> None:
    # ### commands auto generated by Alembic - please adjust! ###
    op.create_unique_constraint(
        "standing_tournament_id_group_id_key", "standing", ["tournament_id", "group_id"]
    )
    # ### end Alembic commands ###
