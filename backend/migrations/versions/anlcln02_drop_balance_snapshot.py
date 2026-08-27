"""Drop unused analytics balance snapshot tables.

Revision ID: anlcln02
Revises: anlcln01
Create Date: 2026-08-25 00:00:00.000000

``analytics.balance_snapshot`` / ``balance_player_snapshot`` were a write-only
copy of ``balancer.balance.result_json`` for an RPC the frontend never called.
Shifts, ML, standings and anomalies never read them.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "anlcln02"
down_revision: str | Sequence[str] | None = "anlcln01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_table("balance_player_snapshot", schema="analytics")
    op.drop_table("balance_snapshot", schema="analytics")


def downgrade() -> None:
    raise NotImplementedError(
        "anlcln02 drops a write-only copy of balancer.balance.result_json; "
        "roll back to anlcln01 if the empty tables are needed."
    )
