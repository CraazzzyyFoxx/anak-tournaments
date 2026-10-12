"""Validate the ``matches.*`` team foreign keys that ``enclayer01`` re-added ``NOT VALID``.

``enclayer01`` rewrites seven foreign keys from ``matches.*`` to ``tournament.team``
(deleting a team no longer deletes the games it played) and leaves them ``NOT
VALID``: the new delete action binds every new row at once, and the scan that
proves the OLD rows is not needed for safety -- the old constraint already held,
and only its delete action changed. That scan is what this revision does, in its
own transaction and with its own, weaker locks, so the 27M-row ``matches.*``
tables are not held under ``enclayer01``'s ACCESS EXCLUSIVE window for it.

``VALIDATE CONSTRAINT`` takes SHARE UPDATE EXCLUSIVE on the table and ROW SHARE
on ``tournament.team``: reads and writes go on while it scans.

``autocommit_block`` commits everything before it -- ``enclayer01`` included --
and runs each statement on its own, so a failure here (or an operator's Ctrl-C
mid-scan) leaves ``enclayer01`` applied and this revision to be re-run.
Idempotent: validating a validated constraint is a no-op.

Revision ID: enclayer01b
Revises: enclayer01
"""

from collections.abc import Sequence

from alembic import op

revision: str = "enclayer01b"
down_revision: str | Sequence[str] | None = "enclayer01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: The seven constraints ``enclayer01._MATCH_TEAM_FKS`` re-adds ``NOT VALID``.
#: Copied, not imported: a migration keeps meaning what it meant when it ran.
_MATCH_TEAM_FKS = (
    ("matches.match", "match_home_team_id_fkey"),
    ("matches.match", "match_away_team_id_fkey"),
    ("matches.statistics", "statistics_team_id_fkey"),
    ("matches.kill_feed", "kill_feed_killer_team_id_fkey"),
    ("matches.kill_feed", "kill_feed_victim_team_id_fkey"),
    ("matches.event", "assists_team_id_fkey"),
    ("matches.event", "assists_related_team_id_fkey"),
)


def upgrade() -> None:
    with op.get_context().autocommit_block():
        for table, name in _MATCH_TEAM_FKS:
            op.execute(f"ALTER TABLE {table} VALIDATE CONSTRAINT {name}")


def downgrade() -> None:
    # Validation is not undone: a validated constraint binds the same rows the
    # unvalidated one did.
    pass
