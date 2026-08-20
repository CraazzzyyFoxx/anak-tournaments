"""One ``pick_ban_entry`` per resolved step, enforced.

Revision ID: pbstep0001
Revises: owemerald01
Create Date: 2026-08-15 00:00:00.000000

``pick_ban_entry.action_index`` is the position in the owning session's resolved
sequence that produced the entry, so two rows sharing one position mean a single
step was resolved twice. Nothing prevented that: every committing path derived
the current step from a read (``pick_ban_engine.get_current_step`` counts the
session's committed entries) and wrote it back without a lock, so two overlapping
requests both resolved the same step. In the room that surfaced as a lopsided ban
phase -- one team with several extra bans, the other missing the steps the extras
consumed -- and, when the collision landed on a round's LAST step, as one action
lost from every later round of the series, the session holding one entry more
than its sequence forever after.

The services now take ``FOR UPDATE`` on the session row before resolving a step.
This index is the backstop: a duplicate that slips through becomes a failed write
instead of silently corrupted history.

Repairing what is already stored, per duplicate group (keeping the lowest id, the
one that actually committed first):

- a ``played`` extra is preserved and renumbered onto a free tail position. It
  has downstream artifacts -- a ``Match`` row, per-map reports -- that must not be
  orphaned. The session keeps its offset; that series is over anyway.
- anything else is deleted. A ban/protect entry is only ever read for the round in
  play (the room never re-renders a finished round's bans), and cross-round ban
  memory lives in ``encounter_pick_ban_ledger``, a separate table this does not
  touch -- so no later round's candidate pool changes. Removing the extra restores
  the step cursor, which is what un-truncates the rest of a live series.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "pbstep0001"
down_revision: str | Sequence[str] | None = "owemerald01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

INDEX_NAME = "uq_pick_ban_entry_session_action_index"

#: Every row that is not the first of its (session, action_index) group.
_EXTRAS = """
    SELECT id, session_id, status,
           row_number() OVER (PARTITION BY session_id, action_index ORDER BY id) AS dup_rank
    FROM tournament.pick_ban_entry
    WHERE action_index IS NOT NULL
"""


def upgrade() -> None:
    # Played extras first: they move out of the way rather than disappear, onto
    # positions past everything the session has ever committed.
    op.execute(
        f"""
        WITH extras AS ({_EXTRAS}),
        moved AS (
            SELECT e.id,
                   row_number() OVER (PARTITION BY e.session_id ORDER BY e.id) AS offset_in_session,
                   e.session_id
            FROM extras e
            WHERE e.dup_rank > 1 AND e.status = 'played'
        ),
        ceiling AS (
            SELECT session_id, max(action_index) AS max_index
            FROM tournament.pick_ban_entry
            WHERE action_index IS NOT NULL
            GROUP BY session_id
        )
        UPDATE tournament.pick_ban_entry AS entry
        SET action_index = ceiling.max_index + moved.offset_in_session
        FROM moved
        JOIN ceiling ON ceiling.session_id = moved.session_id
        WHERE entry.id = moved.id
        """
    )
    op.execute(
        f"""
        WITH extras AS ({_EXTRAS})
        DELETE FROM tournament.pick_ban_entry
        WHERE id IN (SELECT id FROM extras WHERE dup_rank > 1)
        """
    )
    op.create_index(
        INDEX_NAME,
        "pick_ban_entry",
        ["session_id", "action_index"],
        unique=True,
        schema="tournament",
        postgresql_where=sa.text("action_index IS NOT NULL"),
    )


def downgrade() -> None:
    # The repair is not reversible -- a deleted duplicate carried no information
    # the ledger or the reports do not already hold, and there is nothing to
    # restore it from. Dropping the index is the whole of the downgrade.
    op.drop_index(INDEX_NAME, table_name="pick_ban_entry", schema="tournament")
