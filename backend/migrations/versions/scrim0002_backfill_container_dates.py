"""Backfill the scrim container's informational dates.

Revision ID: scrim0002
Revises: scrim0001
Create Date: 2026-08-12 00:00:00.000000

``scrim0001``'s provisioning created the per-workspace scrim container with NULL
``start_date``/``end_date``. Both columns are nullable and drive nothing, but
``TournamentRead`` declares them NOT NULL -- a contract that had held because the
only way to create a tournament is an admin form that requires both -- so the
container 500'd every read that serialises it, including the admin tournament
list, the one list that shows hidden rows:

    2 validation errors for TournamentRead
    start_date  Input should be a valid datetime [input_value=None]
    end_date    Input should be a valid datetime [input_value=None]

``services/scrim/service.py:_ensure_container`` now sets both at creation; this
fills in any container already provisioned by the shipped version.

Scoped to rows that are hidden, named ``Scrims`` AND still NULL, which cannot
match a real tournament: every other creation path requires both dates. Falls
back to ``created_at`` rather than ``now()`` so the value keeps meaning "when
this row came into existence".
"""

from collections.abc import Sequence

from alembic import op

revision: str = "scrim0002"
down_revision: str | Sequence[str] | None = "scrim0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE tournament.tournament
           SET start_date = COALESCE(start_date, created_at),
               end_date   = COALESCE(end_date, created_at)
         WHERE is_hidden IS TRUE
           AND name = 'Scrims'
           AND (start_date IS NULL OR end_date IS NULL)
        """
    )


def downgrade() -> None:
    # Deliberately not reverted: the dates are informational, and restoring NULL
    # would only reintroduce the serialisation failure this fixed.
    pass
