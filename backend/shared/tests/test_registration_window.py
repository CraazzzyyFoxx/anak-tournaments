"""The shared registration-window predicate, and the backfill decision table.

Two distinct claims are covered.

**The predicate** (``is_registration_window_open``): a missing REGISTRATION row
means closed — the deliberate inversion of
``tournament_state.is_within_phase_window`` — and a terminal status is a floor
that no window can override.

**The backfill equivalence** (``regwin0001``): the migration exists because the
new predicate drops the ``status = 'registration'`` conjunct, so a naive
``is_open -> ends_at = NULL`` mapping would silently reopen registration on every
live tournament, and the mirror-image mistake would silently close a tournament
that is open today only via ``allow_late_registration``. The old predicate and the
migration's decision rule are both reimplemented here in Python and checked to
agree across the full cross product of inputs. That is the part most likely to be
reasoned about wrongly; the SQL that implements it needs a database and is
verified separately.
"""

from __future__ import annotations

import itertools
import os
import sys
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest import TestCase

BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("PROJECT_URL", "http://localhost")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("POSTGRES_USER", "postgres")
os.environ.setdefault("POSTGRES_PASSWORD", "postgres")
os.environ.setdefault("POSTGRES_DB", "postgres")
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_PORT", "5432")

from shared.core.enums import TournamentStatus  # noqa: E402
from shared.core.tournament_state import is_within_phase_window  # noqa: E402
from shared.services.registration_window import is_registration_window_open  # noqa: E402

NOW = datetime(2026, 8, 20, 12, 0, tzinfo=UTC)
CREATED = NOW - timedelta(days=30)

_NON_TERMINAL = (
    TournamentStatus.REGISTRATION,
    TournamentStatus.CHECK_IN,
    TournamentStatus.DRAFT,
    TournamentStatus.LIVE,
)


def _row(status: TournamentStatus, starts_at: datetime, ends_at: datetime | None = None) -> SimpleNamespace:
    return SimpleNamespace(status=status, starts_at=starts_at, ends_at=ends_at)


def _reg_row(starts_at: datetime, ends_at: datetime | None = None) -> SimpleNamespace:
    return _row(TournamentStatus.REGISTRATION, starts_at, ends_at)


class PredicateTests(TestCase):
    def test_missing_row_is_closed(self) -> None:
        for status in _NON_TERMINAL:
            self.assertFalse(is_registration_window_open(status, [], NOW), status)

    def test_missing_row_is_closed_even_with_other_phases_scheduled(self) -> None:
        schedule = [_row(TournamentStatus.CHECK_IN, CREATED), _row(TournamentStatus.LIVE, CREATED)]
        self.assertFalse(is_registration_window_open(TournamentStatus.REGISTRATION, schedule, NOW))

    def test_open_ended_window_is_open_in_every_non_terminal_phase(self) -> None:
        schedule = [_reg_row(CREATED)]
        for status in _NON_TERMINAL:
            self.assertTrue(is_registration_window_open(status, schedule, NOW), status)

    def test_terminal_status_overrides_an_open_window(self) -> None:
        schedule = [_reg_row(CREATED)]
        for status in (TournamentStatus.COMPLETED, TournamentStatus.ARCHIVED):
            self.assertFalse(is_registration_window_open(status, schedule, NOW), status)

    def test_boundaries_are_inclusive(self) -> None:
        self.assertTrue(is_registration_window_open(TournamentStatus.REGISTRATION, [_reg_row(NOW)], NOW))
        self.assertTrue(is_registration_window_open(TournamentStatus.REGISTRATION, [_reg_row(CREATED, NOW)], NOW))
        self.assertFalse(
            is_registration_window_open(
                TournamentStatus.REGISTRATION,
                [_reg_row(CREATED, NOW - timedelta(microseconds=1))],
                NOW,
            )
        )
        self.assertFalse(
            is_registration_window_open(
                TournamentStatus.REGISTRATION,
                [_reg_row(NOW + timedelta(microseconds=1))],
                NOW,
            )
        )

    def test_naive_datetimes_are_treated_as_utc(self) -> None:
        naive = [_reg_row(CREATED.replace(tzinfo=None))]
        self.assertTrue(is_registration_window_open(TournamentStatus.REGISTRATION, naive, NOW))


# --------------------------------------------------------------------------- #
# Backfill equivalence
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class _Legacy:
    """The pre-consolidation inputs for one tournament."""

    status: TournamentStatus
    is_open: bool
    allow_late: bool
    row: SimpleNamespace | None

    @property
    def schedule(self) -> list[SimpleNamespace]:
        return [self.row] if self.row is not None else []


def _old_predicate(state: _Legacy, now: datetime) -> bool:
    """Verbatim reimplementation of the removed ``is_registration_open``."""
    if not state.is_open:
        return False
    if state.status in (TournamentStatus.COMPLETED, TournamentStatus.ARCHIVED):
        return False
    if state.status == TournamentStatus.REGISTRATION and is_within_phase_window(
        TournamentStatus.REGISTRATION, state.schedule, now
    ):
        return True
    return state.allow_late


def _apply_backfill(state: _Legacy, now: datetime, *, has_form: bool) -> list[SimpleNamespace]:
    """The decision rule of ``regwin0001``, in Python.

    Mirrors the three statements: insert when open with no row, reopen when open
    with a disagreeing row, close when closed with a row that reads open.
    """
    if state.status in (TournamentStatus.COMPLETED, TournamentStatus.ARCHIVED):
        return state.schedule  # skipped by the migration

    old_open = _old_predicate(state, now)
    new_open = is_registration_window_open(state.status, state.schedule, now)
    if old_open == new_open:
        return state.schedule

    if old_open:
        if state.row is None:
            return [_reg_row(CREATED)]
        return [_reg_row(min(state.row.starts_at, CREATED), None)]

    if not has_form:
        return state.schedule  # migration skips form-less tournaments
    assert state.row is not None  # new_open implies a row exists
    # ``ends_at`` is inclusive, so closing must land STRICTLY before ``now`` —
    # ``ends_at = now`` would leave the window open at that instant. Caught by
    # this very test when the migration was first written that way.
    return [
        _reg_row(
            state.row.starts_at,
            max(now - timedelta(microseconds=1), state.row.starts_at + timedelta(microseconds=1)),
        )
    ]


class BackfillEquivalenceTests(TestCase):
    def _cases(self) -> list[_Legacy]:
        rows = [
            None,
            _reg_row(CREATED),  # open-ended, already started
            _reg_row(CREATED, NOW + timedelta(days=1)),  # currently inside
            _reg_row(CREATED, NOW - timedelta(days=1)),  # already ended
            _reg_row(NOW + timedelta(days=1)),  # not yet started
        ]
        statuses = (*_NON_TERMINAL, TournamentStatus.COMPLETED, TournamentStatus.ARCHIVED)
        return [
            _Legacy(status=status, is_open=is_open, allow_late=allow_late, row=row)
            for status, is_open, allow_late, row in itertools.product(statuses, (True, False), (True, False), rows)
        ]

    def test_backfill_makes_the_new_predicate_agree_with_the_old_one(self) -> None:
        checked = 0
        for state in self._cases():
            old = _old_predicate(state, NOW)
            schedule = _apply_backfill(state, NOW, has_form=True)
            new = is_registration_window_open(state.status, schedule, NOW)
            self.assertEqual(old, new, f"disagreement for {state}")
            checked += 1
        # 6 statuses x is_open x allow_late x 5 row shapes
        self.assertEqual(120, checked)

    def test_the_naive_mapping_would_have_reopened_live_tournaments(self) -> None:
        """Guards the reasoning, not the code: proves the rejected mapping is wrong.

        ``is_open=true -> ends_at=NULL`` on a LIVE tournament without
        ``allow_late_registration`` is closed today and would become open.
        """
        state = _Legacy(status=TournamentStatus.LIVE, is_open=True, allow_late=False, row=None)
        self.assertFalse(_old_predicate(state, NOW))
        naive = [_reg_row(CREATED, None)]
        self.assertTrue(is_registration_window_open(state.status, naive, NOW))
        # The real rule keeps it closed.
        self.assertFalse(
            is_registration_window_open(state.status, _apply_backfill(state, NOW, has_form=True), NOW)
        )

    def test_late_registration_tournaments_stay_open(self) -> None:
        """The mirror-image mistake: open today only via ``allow_late_registration``
        with a window that ended long ago must NOT silently close."""
        state = _Legacy(
            status=TournamentStatus.LIVE,
            is_open=True,
            allow_late=True,
            row=_reg_row(CREATED, NOW - timedelta(days=1)),
        )
        self.assertTrue(_old_predicate(state, NOW))
        self.assertTrue(
            is_registration_window_open(state.status, _apply_backfill(state, NOW, has_form=True), NOW)
        )

    def test_formless_tournaments_are_left_alone(self) -> None:
        """Registration is gated by the form's absence either way, so the migration
        must not touch an operator's pre-set window."""
        row = _reg_row(CREATED)
        state = _Legacy(status=TournamentStatus.LIVE, is_open=False, allow_late=False, row=row)
        self.assertEqual([row], _apply_backfill(state, NOW, has_form=False))
