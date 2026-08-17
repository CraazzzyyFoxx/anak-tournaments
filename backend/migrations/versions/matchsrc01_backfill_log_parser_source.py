"""Backfill ``matches.match.source`` for rows a real log already updated.

Revision ID: matchsrc01
Revises: favplyr01
Create Date: 2026-08-18 00:00:00.000000

Discovered while investigating a "Log coverage" undercount on the admin
tournament page (21/60 instead of the expected ~54/60): ``Encounter.has_logs``
(``enclogsrm1``) derives from ``EXISTS(matches.match WHERE ... AND
source = 'log_parser')``, but ``MatchLogProcessor.start``'s update branch
(``services/match_logs/flows.py``, the ``else`` when a match row already
exists) never stamped ``source`` back to ``log_parser`` when a genuine log
came in and updated a row that started life as ``source=captain_report``
(``map_report.submit_map_report`` upserts one before any log arrives). That
gap predates the ``has_logs`` refactor -- the previous stored boolean was
set independently of ``source`` and never exposed it. The gap in the
processing code itself is already fixed in the same change that added the
stamp; this migration is the one-time data correction for rows written
before that fix shipped.

Detection is exact, not a heuristic: every ``source=captain_report`` row in
production splits cleanly into "no log data at all" (``time``, ``log_name``,
``log_record_id`` all NULL -- a genuine captain-only report) or "all three
populated" (a real log updated it) -- no partial/ambiguous rows exist. Any
one of the three being non-NULL is therefore a safe, precise signal.

Scoped to 76 rows in production as of writing (checked directly against
``anak_v5`` before authoring this migration), effectively all from one
tournament whose captains tended to report before logs were uploaded.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "matchsrc01"
down_revision: str | Sequence[str] | None = "favplyr01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        sa.text(
            "UPDATE matches.match SET source = 'log_parser' "
            "WHERE source = 'captain_report' "
            "AND (time IS NOT NULL OR log_name IS NOT NULL OR log_record_id IS NOT NULL)"
        )
    )


def downgrade() -> None:
    # Not reversible: a corrected row carries no marker distinguishing it
    # from a row that was always ``log_parser``, so there is nothing to
    # restore it to.
    pass
