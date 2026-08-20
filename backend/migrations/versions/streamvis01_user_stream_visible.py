"""Add ``players.user.stream_visible``.

Revision ID: streamvis01
Revises: tlink0001
Create Date: 2026-08-16 00:00:00.000000

Until now, "show my Twitch on my profile" and "surface my live stream on
tournament pages" were the same switch: the only way to stay off the tournament
page was to hide the account from the public profile entirely
(``social_account_visibility``). Worse, the verified path in stream-service had
no per-tournament consent at all — a verified, publicly visible Twitch account
was enough. This column separates the two so a participant can keep their handle
on their profile and still refuse to be broadcast.

Semantics are a veto: ``false`` outranks the per-tournament
``balancer.registration.stream_pov`` opt-in AND the social account's global
visibility row. Enforced in stream-service at both the poll-target query and the
public read, so a flip takes effect immediately rather than at the next tick.

``server_default='true'`` so the deploy itself hides nobody — existing rows keep
the behaviour they had, and opting out stays an explicit act.

Getting the lock is the hard part; see ``_with_lock_retry``. If this still gives
up, something is holding a lock on the table for longer than the retry window,
and no amount of retrying will help. Name it::

    SELECT a.pid, a.state, a.application_name,
           now() - a.xact_start AS in_xact,
           left(a.query, 120) AS query
    FROM pg_locks l
    JOIN pg_stat_activity a USING (pid)
    WHERE l.relation = 'players."user"'::regclass
      AND a.pid <> pg_backend_pid()
    ORDER BY a.xact_start;

The usual suspect is a transaction that is long-running rather than stuck: the
hero-stats refresh (``app-service/src/services/hero_stats_refresh.py``) runs for
minutes with ``statement_timeout`` disabled and holds ACCESS SHARE the whole
time. Wait for it, or re-run the migration; do not disable ``lock_timeout``.
"""

import time
from collections.abc import Callable, Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.exc import OperationalError

revision: str = "streamvis01"
down_revision: str | Sequence[str] | None = "tlink0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# SQLSTATE 55P03 (``lock_not_available``): the statement was cancelled because
# it could not take its lock inside ``lock_timeout``. Matched precisely so a
# real failure — a bad type, a missing table — raises on the first attempt
# instead of being retried forty times and reported as a lock problem.
LOCK_NOT_AVAILABLE = "55P03"

# Grab the lock quickly or not at all. Deliberately short: while an ALTER waits
# for ACCESS EXCLUSIVE it queues AHEAD of every later reader, so a long wait
# does not just delay the migration, it stalls every service behind it. Three
# seconds is long enough to win a gap in traffic and short enough that a lost
# attempt is invisible to the fleet.
LOCK_TIMEOUT = "3s"
# Roughly six minutes of wall clock in the worst case. Generous on purpose: the
# blocker this has to outlast is a multi-minute analytics transaction, not a
# request. It is still bounded, so a genuinely stuck session fails the deploy
# instead of hanging it.
LOCK_ATTEMPTS = 40
LOCK_BACKOFF_SECONDS = 6.0


def _with_lock_retry(operation: Callable[[], None]) -> None:
    """Run a DDL statement, retrying while Postgres refuses it the lock.

    ``players."user"`` is the hottest table in the schema — every service reads
    it — so ACCESS EXCLUSIVE has to be taken in a gap between transactions, and
    the first run of this migration was cancelled waiting for one. The column
    itself is free: PostgreSQL 11+ records a non-volatile DEFAULT in the catalog
    rather than rewriting the table, so the ALTER holds the lock for microseconds
    once it has it. All the difficulty is in acquiring it.

    Waiting indefinitely (``lock_timeout = 0``) is the wrong fix, and is why the
    role carries a timeout at all: a queued ALTER blocks every reader that
    arrives after it, so one multi-minute SELECT — the hero-stats refresh runs
    with ``statement_timeout`` disabled — would turn a metadata change into a
    fleet-wide stall. Short timeout plus retry keeps every failed attempt
    invisible.

    Each attempt is its own SAVEPOINT: a cancelled statement aborts the
    transaction alembic wraps the migration in, and the next attempt needs a
    clean one to run in. ``SET LOCAL`` is issued outside the savepoint so
    rolling one back does not also roll back the timeout.
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
    _with_lock_retry(
        lambda: op.add_column(
            "user",
            sa.Column("stream_visible", sa.Boolean(), server_default="true", nullable=False),
            schema="players",
        )
    )


def downgrade() -> None:
    # Same lock, same queue-ahead hazard: DROP COLUMN also takes ACCESS
    # EXCLUSIVE on the same hot table.
    _with_lock_retry(lambda: op.drop_column("user", "stream_visible", schema="players"))
