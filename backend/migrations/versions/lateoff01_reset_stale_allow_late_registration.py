"""Reset residual ``tournament.allow_late_registration`` values.

Revision ID: lateoff01
Revises: encactor1
Create Date: 2026-09-02 00:00:00.000000

``regwin0001`` consolidated registration openness onto the ``REGISTRATION`` row of
``tournament_phase_schedule`` and dropped this flag from the predicate -- but not
from the table, the admin upsert schema, or the tournament read. It has therefore
been a live, writable, serialized column that no code consulted: a switch that
lied to whoever flipped it.

The predicate now honours it again, as the narrow "lift ``ends_at``" override (see
``shared.services.registration_window``). That makes every value stored while the
flag was dead a stale opinion formed under a different rule set, and honouring
those retroactively would silently REOPEN registration on any tournament that
carries ``true`` and whose window has since ended -- a data accident, not a feature.

So reset them. The *intent* of late registration is not lost: ``regwin0001`` already
encoded it into the schedule, extending ``ends_at`` to NULL for every tournament
that was open via this flag at the time (its second statement). Those tournaments
stay open through their window, exactly as they are today. The reset therefore
changes nobody's openness on ship day, and the flag starts from a clean ``false``
whose next value is a deliberate organizer decision.

Irreversible by design: the pre-reset values carry no meaning to restore, so
``downgrade`` is a no-op rather than a fabricated one.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "lateoff01"
down_revision: str | Sequence[str] | None = "encactor1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE tournament.tournament
        SET allow_late_registration = false
        WHERE allow_late_registration
        """
    )


def downgrade() -> None:
    """No-op: see the module docstring. The reset values are unrecoverable and
    meaningless -- they were written against a predicate that ignored them."""
