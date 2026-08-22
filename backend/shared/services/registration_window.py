"""Whether self-service registration is open — the single source of truth.

Registration openness used to be a conjunction of three knobs across two owners::

    form.is_open                                   # BalancerRegistrationForm
    AND not is_finished_for_status(status)
    AND ( (status == REGISTRATION AND is_within_phase_window(REGISTRATION, ...))
          OR tournament.allow_late_registration )  # Tournament

It is now one: the ``REGISTRATION`` row of ``tournament_phase_schedule``. Opening,
extending and closing registration are all edits to that row's window, and the
tournament's own phase no longer participates — late registration is expressed by
an ``ends_at`` beyond the LIVE start rather than by a separate boolean.

Two deliberate properties
-------------------------
**A missing row means CLOSED.** This inverts
``tournament_state.is_within_phase_window``, whose documented contract is that a
missing row "spans the whole phase". That contract is load-bearing for
``is_check_in_window_active``, so it is NOT changed — the inversion lives here,
for registration only. Without the inversion the default would flip from closed
(``is_open`` defaulted to ``false``) to open, and a freshly created tournament
would accept registrations before its form was configured.

**Terminal statuses are a floor, not a knob.** COMPLETED/ARCHIVED is always
closed regardless of the window, so a mis-set ``ends_at`` can never reopen an
archived tournament.

Both a Python predicate and a SQL clause are provided because openness is read
both per-tournament and inside aggregate queries in three different services
(dashboard readiness, dashboard counts, subscription-collection targeting,
subscription-config preview).
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import UTC, datetime

import sqlalchemy as sa

from shared.core.enums import TournamentStatus
from shared.core.tournament_state import PhaseScheduleEntry, is_finished_for_status
from shared.models.tournament.tournament import Tournament, TournamentPhaseSchedule

__all__ = ("is_registration_window_open", "registration_open_clause")


def is_registration_window_open(
    status: TournamentStatus,
    schedule: Iterable[PhaseScheduleEntry],
    now: datetime | None = None,
) -> bool:
    """``True`` while ``now`` is inside the REGISTRATION row's window.

    Deliberately takes the status and schedule rather than a ``Tournament`` so it
    can be unit-tested without a mapped instance, and so callers holding only a
    projection can use it.
    """
    if is_finished_for_status(status):
        return False

    entry = next((e for e in schedule if e.status == TournamentStatus.REGISTRATION), None)
    if entry is None:
        # The inversion: no schedule row => registration was never opened.
        return False

    moment = now or datetime.now(UTC)
    starts_at = _as_utc(entry.starts_at)
    if starts_at > moment:
        return False
    return entry.ends_at is None or moment <= _as_utc(entry.ends_at)


def registration_open_clause(now: datetime | None = None) -> sa.ColumnElement[bool]:
    """SQL form of :func:`is_registration_window_open`, correlated on ``Tournament``.

    Usable anywhere ``tournament.tournament`` is already in the FROM list, e.g.::

        sa.select(sa.func.count(Tournament.id)).where(registration_open_clause())

    Mirrors the Python predicate exactly, including "missing row => closed"
    (``EXISTS`` fails when there is no row) and the terminal-status floor.
    """
    moment = now or datetime.now(UTC)
    window = (
        sa.select(sa.literal(1))
        .select_from(TournamentPhaseSchedule)
        .where(
            TournamentPhaseSchedule.tournament_id == Tournament.id,
            TournamentPhaseSchedule.status == TournamentStatus.REGISTRATION,
            TournamentPhaseSchedule.starts_at <= moment,
            sa.or_(
                TournamentPhaseSchedule.ends_at.is_(None),
                TournamentPhaseSchedule.ends_at >= moment,
            ),
        )
        .exists()
    )
    return sa.and_(
        Tournament.status.notin_([TournamentStatus.COMPLETED, TournamentStatus.ARCHIVED]),
        window,
    )


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)
