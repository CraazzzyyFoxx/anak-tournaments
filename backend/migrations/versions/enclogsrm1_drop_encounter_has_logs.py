"""Drop ``tournament.encounter.has_logs``.

Revision ID: enclogsrm1
Revises: streamvis01
Create Date: 2026-08-17 00:00:00.000000

The column was a denormalized cache of "does this encounter have a parsed
match log", set exactly once by ``parser-service``
(``services/match_logs/flows.py``) the first time a log produced a
``matches.match`` row, and never reset back to ``false`` on any code path.
That makes it fully and safely derivable:

    has_logs == EXISTS(SELECT 1 FROM matches.match WHERE encounter_id = encounter.id AND source = 'log_parser')

``shared/models/matches/match.py`` now exposes ``Encounter.has_logs`` as a
``column_property`` built from exactly that EXISTS, correlated on the
already-indexed ``match.encounter_id`` foreign key -- the same pattern
already used for ``Team.avg_sr``/``Team.total_sr``. Every read/filter call
site keeps working unchanged; the only thing removed is the manual writer
and the storage.

Same lock hazard as ``streamvis01``: ``tournament.encounter`` is read on
nearly every tournament page (live/upcoming feeds, standings, bracket
rendering), so ``ALTER TABLE ... DROP COLUMN`` has to grab ACCESS EXCLUSIVE
in a gap between transactions rather than queue and stall every reader
behind it.
"""

import time
from collections.abc import Callable, Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.exc import OperationalError

revision: str = "enclogsrm1"
down_revision: str | Sequence[str] | None = "streamvis01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

LOCK_NOT_AVAILABLE = "55P03"
LOCK_TIMEOUT = "3s"
LOCK_ATTEMPTS = 40
LOCK_BACKOFF_SECONDS = 6.0


def _with_lock_retry(operation: Callable[[], None]) -> None:
    """Run a DDL statement, retrying while Postgres refuses it the lock.

    See ``streamvis01_user_stream_visible.py`` for the full rationale; same
    technique, applied to ``tournament.encounter`` instead of
    ``players."user"``.
    """
    bind = op.get_bind()
    bind.execute(sa.text(f"SET LOCAL lock_timeout = '{LOCK_TIMEOUT}'"))

    for attempt in range(1, LOCK_ATTEMPTS + 1):
        savepoint = bind.begin_nested()
        try:
            operation()
        except OperationalError as exc:
            savepoint.rollback()
            if getattr(exc.orig, "sqlstate", None) != LOCK_NOT_AVAILABLE:
                raise
            if attempt == LOCK_ATTEMPTS:
                raise
            time.sleep(LOCK_BACKOFF_SECONDS)
        else:
            savepoint.commit()
            return


def upgrade() -> None:
    _with_lock_retry(lambda: op.drop_column("encounter", "has_logs", schema="tournament"))


def downgrade() -> None:
    # Reconstructable, unlike a lossy backfill: the source of truth
    # (``matches.match``) still exists, so the restored column can be
    # correctly populated rather than merely re-created with a guessed
    # default.
    _with_lock_retry(
        lambda: op.add_column(
            "encounter",
            sa.Column("has_logs", sa.Boolean(), nullable=True),
            schema="tournament",
        )
    )
    op.execute(
        sa.text(
            "UPDATE tournament.encounter e SET has_logs = EXISTS ("
            "SELECT 1 FROM matches.match m "
            "WHERE m.encounter_id = e.id AND m.source = 'log_parser'"
            ")"
        )
    )
    _with_lock_retry(lambda: op.alter_column("encounter", "has_logs", nullable=False, schema="tournament"))
