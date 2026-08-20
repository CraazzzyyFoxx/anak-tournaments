"""Purge protects from the cross-round BAN ledger.

Revision ID: pbledger01
Revises: pbstep0001
Create Date: 2026-08-15 00:00:00.000000

``encounter_pick_ban_ledger`` is ban memory: its rows are applied as item-level
exclusions when a later round's candidate pool is built, so a row means "this
item is spent for the rest of the series". Until the code fix, a ``protect`` was
booked into it under ``banned_by_side`` exactly like a ban -- which turned a
round-local immunity into a series-wide ban. Under ``no_repeat_scope=encounter``
the hero vanished from every later map's pool; under ``encounter_same_side`` the
side that shielded it could no longer ban it.

The code stopped writing those rows, but nothing removed the ones already
stored, so every encounter whose earlier rounds ran on the old code still plays
by the old rule -- a hero protected on map 1 remains unbannable on map 2.

A stale row is identifiable without guessing: it has a matching ``protected_by``
entry in the session for its ``(encounter_id, kind)`` and NO matching
``picked_by`` ban entry. Where the side both banned and protected the same item
across the series, the single ledger row (unique per
``encounter_id, kind, item_id, banned_by_side``) is earned by the ban and stays.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "pbledger01"
down_revision: str | Sequence[str] | None = "pbstep0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        DELETE FROM tournament.encounter_pick_ban_ledger AS ledger
        WHERE EXISTS (
            SELECT 1
            FROM tournament.pick_ban_entry AS entry
            JOIN tournament.pick_ban_session AS pb ON pb.id = entry.session_id
            WHERE pb.encounter_id = ledger.encounter_id
              AND pb.kind = ledger.kind
              AND entry.item_id = ledger.item_id
              AND entry.status = 'protected'
              AND entry.protected_by = ledger.banned_by_side
        )
        AND NOT EXISTS (
            SELECT 1
            FROM tournament.pick_ban_entry AS entry
            JOIN tournament.pick_ban_session AS pb ON pb.id = entry.session_id
            WHERE pb.encounter_id = ledger.encounter_id
              AND pb.kind = ledger.kind
              AND entry.item_id = ledger.item_id
              AND entry.status = 'banned'
              AND entry.picked_by = ledger.banned_by_side
        )
        """
    )


def downgrade() -> None:
    # Nothing to restore: the deleted rows encoded a rule the engine no longer
    # implements, and re-deriving them would reintroduce the bug.
    pass
