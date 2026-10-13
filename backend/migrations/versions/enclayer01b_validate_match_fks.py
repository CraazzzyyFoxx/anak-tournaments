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

import sqlalchemy as sa
from alembic import op

revision: str = "enclayer01b"
down_revision: str | Sequence[str] | None = "enclayer01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: The seven columns ``enclayer01._MATCH_TEAM_FKS`` re-adds a ``NOT VALID`` team
#: foreign key on. Copied, not imported: a migration keeps meaning what it meant
#: when it ran. The constraint is found by its column, not its name: the live
#: database does not name these the way a chain-built one does.
_MATCH_TEAM_FKS = (
    ("matches.match", "home_team_id"),
    ("matches.match", "away_team_id"),
    ("matches.statistics", "team_id"),
    ("matches.kill_feed", "killer_team_id"),
    ("matches.kill_feed", "victim_team_id"),
    ("matches.event", "team_id"),
    ("matches.event", "related_team_id"),
)

_NOT_VALID_FKS_ON = """
    SELECT c.conname FROM pg_constraint c
     WHERE c.conrelid = CAST(:table AS regclass) AND c.contype = 'f' AND NOT c.convalidated
       AND ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
                   JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
                  ORDER BY k.ord) = CAST(:columns AS text[])
"""


def upgrade() -> None:
    with op.get_context().autocommit_block():
        for table, column in _MATCH_TEAM_FKS:
            rows = op.get_bind().execute(sa.text(_NOT_VALID_FKS_ON), {"table": table, "columns": [column]})
            for (name,) in rows.all():
                op.execute(f'ALTER TABLE {table} VALIDATE CONSTRAINT "{name}"')


def downgrade() -> None:
    # Validation is not undone: a validated constraint binds the same rows the
    # unvalidated one did.
    pass
