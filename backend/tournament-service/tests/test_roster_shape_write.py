"""Draft-format writes and the active-draft guard; team-format writes have their own tests."""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "tournament-service"))

os.environ["DEBUG"] = "true"

from shared.core.errors import BaseAPIException  # noqa: E402
from src import schemas  # noqa: E402
from src.services.admin import tournament as admin_tournament  # noqa: E402
from src.services.draft_guards import assert_no_active_draft_session  # noqa: E402

# The exact detail the guard produced before it took a ``change`` argument. Its
# two existing callers pass no ``change``, so this string must stay byte-identical.
_LEGACY_DETAIL = (
    "Cannot change team formation while a draft session is active (status: live). Cancel or complete the draft first."
)


class _FakeResult:
    """Mirrors the two shapes the code under test reads a result through:
    the guard's ``scalar_one_or_none`` and the repository's
    ``.unique().scalars().first()``."""

    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value

    def unique(self):
        return self

    def scalars(self):
        return self

    def first(self):
        return self._value

    def all(self):
        return [] if self._value is None else [self._value]


class _FakeSession:
    """Just enough of AsyncSession to drive ``update_tournament`` without a DB.

    ``scalar`` mirrors the guard's ``status NOT IN (cancelled, completed)``
    filter: a terminal status is invisible to the query, exactly as in Postgres.
    """

    _TERMINAL = {"cancelled", "completed"}

    def __init__(self, tournament=None, draft_status=None):
        self._tournament = tournament
        self._draft_status = draft_status
        self.scalar_stmts: list = []
        self.committed = False

    async def execute(self, stmt):
        return _FakeResult(self._tournament)

    async def scalar(self, stmt):
        self.scalar_stmts.append(stmt)
        if self._draft_status in self._TERMINAL:
            return None
        return self._draft_status

    async def commit(self):
        self.committed = True


def test_guard_keeps_the_legacy_message_when_no_change_is_named() -> None:
    session = _FakeSession(draft_status="live")
    with pytest.raises(BaseAPIException) as exc_info:
        asyncio.run(assert_no_active_draft_session(session, 1))
    assert exc_info.value.detail == _LEGACY_DETAIL


def test_guard_names_the_roster_shape_and_the_blocking_status() -> None:
    session = _FakeSession(draft_status="picking")
    with pytest.raises(BaseAPIException) as exc_info:
        asyncio.run(assert_no_active_draft_session(session, 1, change="roster shape"))
    assert "roster shape" in exc_info.value.detail
    assert "picking" in exc_info.value.detail
    assert exc_info.value.status_code == 400


def test_guard_query_excludes_terminal_statuses() -> None:
    session = _FakeSession(draft_status=None)
    asyncio.run(assert_no_active_draft_session(session, 1, change="roster shape"))
    compiled = str(session.scalar_stmts[0].compile(compile_kwargs={"literal_binds": True}))
    assert "cancelled" in compiled and "completed" in compiled


# ─── update_tournament ───────────────────────────────────────────────────────


def _run_update(
    monkeypatch,
    *,
    draft_status: str | None,
    update: schemas.TournamentUpdate,
    stored_format: dict | None = None,
):
    """Return (error, session, tournament, unused)."""
    tournament = SimpleNamespace(
        id=1,
        workspace_id=1,
        team_formation="draft",
        division_grid_version_id=None,
        draft_format_json=stored_format,
    )
    session = _FakeSession(tournament=tournament, draft_status=draft_status)

    async def _noop(*args, **kwargs):
        return tournament

    monkeypatch.setattr(admin_tournament, "publish_tournament_invalidation", _noop)
    monkeypatch.setattr(admin_tournament.tournament_service, "get_tournament", _noop)

    error: BaseAPIException | None = None
    try:
        asyncio.run(admin_tournament.tournament_service.update_tournament(session, tournament.id, update))
    except BaseAPIException as exc:
        error = exc
    return error, session, tournament, None


def test_other_fields_are_editable_mid_draft(monkeypatch) -> None:
    error, session, _, spy = _run_update(
        monkeypatch,
        draft_status="live",
        update=schemas.TournamentUpdate(name="renamed"),
    )
    assert error is None
    assert session.scalar_stmts == []
    assert session.committed is True


# ─── update_tournament: the draft format is locked by the same guard ──────────

_CUSTOM_FORMAT = {"format": "custom", "round_rules": ["reverse"], "avg_tie_seed_reverse": True}


def test_draft_format_change_blocked_by_unfinished_draft(monkeypatch) -> None:
    # The session snapshots the format at create time, so an edit mid-draft would
    # promise a change the running board will never honour.
    error, session, tournament, _ = _run_update(
        monkeypatch,
        draft_status="live",
        update=schemas.TournamentUpdate(draft_format_json=_CUSTOM_FORMAT),
    )
    assert error is not None and error.status_code == 400
    assert "the draft format" in error.detail
    assert session.committed is False
    assert tournament.draft_format_json is None  # unchanged


def test_draft_format_change_accepted_without_an_active_draft(monkeypatch) -> None:
    error, session, tournament, _ = _run_update(
        monkeypatch,
        draft_status=None,
        update=schemas.TournamentUpdate(draft_format_json=_CUSTOM_FORMAT),
    )
    assert error is None
    assert session.committed is True
    assert tournament.draft_format_json == _CUSTOM_FORMAT


def test_resending_the_same_format_does_not_trip_the_guard(monkeypatch) -> None:
    # Same reason as the roster shape: the Settings tab submits every field.
    error, session, _, _ = _run_update(
        monkeypatch,
        draft_status="live",
        update=schemas.TournamentUpdate(draft_format_json=dict(_CUSTOM_FORMAT), name="renamed"),
        stored_format=dict(_CUSTOM_FORMAT),
    )
    assert error is None
    assert session.scalar_stmts == []  # guard query never issued
    assert session.committed is True


def test_a_snake_resend_that_drops_stale_rules_still_counts_as_a_change(monkeypatch) -> None:
    # Normalization at the schema edge is what makes the equality check
    # meaningful: switching custom -> snake really does change the stored value.
    error, _, tournament, _ = _run_update(
        monkeypatch,
        draft_status=None,
        update=schemas.TournamentUpdate(draft_format_json={"format": "snake", "round_rules": ["reverse"]}),
        stored_format=dict(_CUSTOM_FORMAT),
    )
    assert error is None
    assert tournament.draft_format_json == {"format": "snake", "round_rules": [], "avg_tie_seed_reverse": False}
