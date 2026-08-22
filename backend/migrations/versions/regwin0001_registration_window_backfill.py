"""Backfill the REGISTRATION phase window so schedule-only gating is behaviour-neutral.

Revision ID: regwin0001
Revises: ncscope01
Create Date: 2026-08-20 00:00:00.000000

Registration openness used to be a conjunction of three knobs across two owners::

    balancer.registration_form.is_open
    AND tournament.status NOT IN ('completed','archived')
    AND ( (status = 'registration' AND now() inside the REGISTRATION window)
          OR tournament.allow_late_registration )

It is now exactly one: the REGISTRATION row of ``tournament_phase_schedule``.
Both dropped knobs still exist as columns after this migration (they are removed
in the contract step); this migration only makes the *new* predicate return, for
every live tournament, what the *old* one returned.

Why this is not the naive "insert a row wherever one is missing"
----------------------------------------------------------------
The new predicate deliberately drops the ``status = 'registration'`` conjunct —
that is what lets late registration be expressed as an ``ends_at`` beyond the
LIVE start instead of a separate boolean. Composed with ``ends_at IS NULL``
already meaning "open-ended", a mapping of ``is_open = true -> ends_at = NULL``
would make every non-finished tournament with ``is_open = true`` — **including
those already in CHECK_IN, DRAFT or LIVE** — permanently open for self-service
registration the moment this ships. ``self_register`` and the subscription gate
are per-user capability checks and would not restore a phase gate.

The reverse error is just as easy: a tournament that is open *today* only because
``allow_late_registration`` is set, whose REGISTRATION window has long since
ended, would silently CLOSE.

So this migration evaluates the OLD predicate per tournament and only touches
rows where the new predicate would disagree:

===========================  ==========================================
old open, no row             INSERT (starts_at = created_at, ends_at = NULL)
old open, row says closed    UPDATE starts_at back, ends_at = NULL
old closed, row says open    UPDATE ends_at = now()
they already agree           left alone
===========================  ==========================================

Tournaments with no ``registration_form`` row are skipped entirely: registration
is gated by the form's absence either way (``submit_public_registration`` 400s on
a missing form), so closing an operator's pre-set window would be intrusive and
change nothing.

Terminal tournaments (COMPLETED/ARCHIVED) are skipped: the new predicate floors
them closed regardless of any window, and the state machine never transitions
back to REGISTRATION from either.

A missing row therefore remains legitimate for a legacy tournament that was
closed anyway — "no row" and "closed window" are the same answer. New tournaments
get the row from the creation wizard, where it is now required.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "regwin0001"
down_revision: str | Sequence[str] | None = "ncscope01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# ``values_callable`` on TOURNAMENT_STATUS_ENUM stores the StrEnum *values*, so
# these literals are lowercase.
_STATE_CTE = """
WITH state AS (
    SELECT
        t.id                       AS tournament_id,
        t.created_at               AS tournament_created_at,
        r.id                       AS row_id,
        (f.id IS NOT NULL)         AS has_form,
        (
            COALESCE(f.is_open, FALSE)
            AND (
                (
                    t.status = 'registration'::tournament.tournamentstatus
                    AND (
                        r.id IS NULL
                        OR (
                            r.starts_at <= now()
                            AND (r.ends_at IS NULL OR now() <= r.ends_at)
                        )
                    )
                )
                OR t.allow_late_registration
            )
        )                          AS old_open,
        (
            r.id IS NOT NULL
            AND r.starts_at <= now()
            AND (r.ends_at IS NULL OR now() <= r.ends_at)
        )                          AS new_open
    FROM tournament.tournament t
    LEFT JOIN balancer.registration_form f
           ON f.tournament_id = t.id
    LEFT JOIN tournament.tournament_phase_schedule r
           ON r.tournament_id = t.id
          AND r.status = 'registration'::tournament.tournamentstatus
    WHERE t.status NOT IN (
        'completed'::tournament.tournamentstatus,
        'archived'::tournament.tournamentstatus
    )
)
"""


def upgrade() -> None:
    # 1. Open today, no window at all -> give it an open-ended window starting
    #    when the tournament was created.
    op.execute(
        sa.text(
            _STATE_CTE
            + """
            INSERT INTO tournament.tournament_phase_schedule
                (tournament_id, status, starts_at, ends_at)
            SELECT
                s.tournament_id,
                'registration'::tournament.tournamentstatus,
                s.tournament_created_at,
                NULL
            FROM state s
            WHERE s.old_open AND s.row_id IS NULL
            """
        )
    )

    # 2. Open today, but the existing window would read closed (not started yet,
    #    or already ended) -> pull the start back and drop the end.
    op.execute(
        sa.text(
            _STATE_CTE
            + """
            UPDATE tournament.tournament_phase_schedule ps
            SET starts_at = LEAST(ps.starts_at, s.tournament_created_at),
                ends_at   = NULL,
                updated_at = now()
            FROM state s
            WHERE ps.id = s.row_id
              AND s.old_open
              AND NOT s.new_open
            """
        )
    )

    # 3. Closed today, but the existing window would read open -> end it.
    #    ``ends_at`` is INCLUSIVE in the predicate (``now <= ends_at``), so
    #    ``ends_at = now()`` would leave the window open at that very instant —
    #    it has to land strictly before now. ``new_open`` guarantees
    #    ``starts_at <= now()``, and for any pre-existing row ``starts_at`` is
    #    strictly earlier than this statement's ``now()``; the GREATEST is belt
    #    and braces so the statement can never violate
    #    ``ck_tournament_phase_schedule_window`` (ends_at > starts_at).
    op.execute(
        sa.text(
            _STATE_CTE
            + """
            UPDATE tournament.tournament_phase_schedule ps
            SET ends_at = GREATEST(
                    now() - interval '1 microsecond',
                    ps.starts_at + interval '1 microsecond'
                ),
                updated_at = now()
            FROM state s
            WHERE ps.id = s.row_id
              AND s.has_form
              AND NOT s.old_open
              AND s.new_open
            """
        )
    )


def downgrade() -> None:
    # Not reversible. A synthesized or adjusted window carries no marker
    # distinguishing it from one an operator set by hand, and the columns this
    # migration read (``is_open``, ``allow_late_registration``) are still present
    # and unchanged — so rolling the code back restores the old behaviour without
    # needing the rows removed.
    pass
