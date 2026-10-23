"""Tests for the time-driven tournament status tick (``run_due_transitions``).

Two layers:

1. Mocked control-flow tests that always run: candidate selection results are
   faked, ``transition_status`` is patched — verifying due/not-due decisions,
   ``automated=True`` propagation, and per-tournament error isolation.
2. Real-DB integration tests (mirroring the skip pattern of
   ``test_registration_self_register_gate.py``): the DB is probed once per test
   and any connection failure skips cleanly; the tests refuse to run against a
   production database. ``transition_status`` commits internally, so each test
   uses a throwaway workspace/tournament (uuid-suffixed) and deletes the
   workspace afterwards (FK cascade cleans up the rest).
"""

from __future__ import annotations

import asyncio
import sys
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "tournament-service"))

import sqlalchemy as sa  # noqa: E402

from shared.core import enums  # noqa: E402
from shared.models.encounter import ScoringRule  # noqa: E402
from shared.models.platform.outbox import EventOutbox  # noqa: E402
from shared.models.tenancy.workspace import Workspace  # noqa: E402
from shared.models.tournament import (  # noqa: E402
    Stage,
    StageItem,
    StageItemInput,
    Team,
    Tournament,
    TournamentComputationJob,
    TournamentPhaseSchedule,
)
from shared.testing import real_db_sessionmaker as _db_sessions  # noqa: E402
from src.services.admin import tournament as admin_tournament_service  # noqa: E402
from src.services.tournament import auto_transitions  # noqa: E402

NOW = datetime.now(UTC)

# ─── Mocked control-flow tests (no DB required) ──────────────────────────────


class _FakeSessionCtx:
    def __init__(self, session: SimpleNamespace) -> None:
        self._session = session

    async def __aenter__(self) -> SimpleNamespace:
        return self._session

    async def __aexit__(self, *exc_info: object) -> bool:
        return False


def _result_with_ids(ids: list[int]) -> Mock:
    result = Mock()
    result.scalars.return_value.all.return_value = ids
    return result


def _result_with_row(row: object | None) -> Mock:
    result = Mock()
    result.scalar_one_or_none.return_value = row
    return result


def _session_returning(result: Mock) -> SimpleNamespace:
    return SimpleNamespace(execute=AsyncMock(return_value=result))


def _schedule_row(status: enums.TournamentStatus, starts_in: timedelta) -> SimpleNamespace:
    return SimpleNamespace(status=status, starts_at=NOW + starts_in, ends_at=None)


def test_run_due_transitions_transitions_due_and_isolates_failures() -> None:
    """Candidate 1 blows up, candidate 2 still transitions with automated=True."""
    failing = SimpleNamespace(
        id=1,
        status=enums.TournamentStatus.REGISTRATION,
        phase_schedule=[_schedule_row(enums.TournamentStatus.CHECK_IN, timedelta(minutes=-5))],
    )
    due = SimpleNamespace(
        id=2,
        status=enums.TournamentStatus.CHECK_IN,
        phase_schedule=[_schedule_row(enums.TournamentStatus.LIVE, timedelta(minutes=-1))],
    )
    sessions = [
        _session_returning(_result_with_ids([1, 2])),
        _session_returning(_result_with_row(failing)),
        _session_returning(_result_with_row(due)),
    ]
    session_factory = Mock(side_effect=[_FakeSessionCtx(s) for s in sessions])

    transition = AsyncMock(side_effect=[RuntimeError("boom"), due])
    with patch.object(auto_transitions.admin_tournament_service, "transition_status", transition):
        results = asyncio.run(auto_transitions.run_due_transitions(session_factory))

    assert [r["status"] for r in results] == ["failed", "success"]
    assert results[0] == {"tournament_id": 1, "status": "failed", "error": "boom"}
    assert results[1]["tournament_id"] == 2
    assert results[1]["old_status"] == enums.TournamentStatus.CHECK_IN.value
    assert results[1]["new_status"] == enums.TournamentStatus.LIVE.value
    assert results[1]["lag_seconds"] is not None and results[1]["lag_seconds"] >= 0
    # Both attempts went through transition_status with automated=True.
    assert transition.await_count == 2
    for call in transition.await_args_list:
        assert call.kwargs == {"automated": True}


def test_run_due_transitions_skips_not_due_and_vanished_candidates() -> None:
    """Future-only schedule rows and lock-lost/paused candidates are skipped."""
    not_due = SimpleNamespace(
        id=3,
        status=enums.TournamentStatus.REGISTRATION,
        phase_schedule=[_schedule_row(enums.TournamentStatus.CHECK_IN, timedelta(hours=1))],
    )
    sessions = [
        _session_returning(_result_with_ids([3, 4])),
        _session_returning(_result_with_row(not_due)),
        # Candidate 4 vanished under the re-check (paused / locked / advanced).
        _session_returning(_result_with_row(None)),
    ]
    session_factory = Mock(side_effect=[_FakeSessionCtx(s) for s in sessions])

    transition = AsyncMock()
    with patch.object(auto_transitions.admin_tournament_service, "transition_status", transition):
        results = asyncio.run(auto_transitions.run_due_transitions(session_factory))

    assert results == []
    transition.assert_not_awaited()


def test_run_due_transitions_skips_opening_registration_without_a_form() -> None:
    """A due REGISTRATION row on a tournament with no form leaves it where it is.

    The tick re-evaluates this candidate every 30 s, so the admin path's 409
    would be a log flood here; the phase simply does not advance until someone
    saves the form.
    """
    formless = SimpleNamespace(
        id=5,
        status=enums.TournamentStatus.ANNOUNCEMENT,
        phase_schedule=[_schedule_row(enums.TournamentStatus.REGISTRATION, timedelta(minutes=-5))],
    )
    sessions = [
        _session_returning(_result_with_ids([5])),
        _session_returning(_result_with_row(formless)),
    ]
    session_factory = Mock(side_effect=[_FakeSessionCtx(s) for s in sessions])

    transition = AsyncMock()
    with (
        patch.object(auto_transitions.admin_tournament_service, "transition_status", transition),
        patch.object(
            auto_transitions.admin_tournament_service,
            "has_registration_form",
            AsyncMock(return_value=False),
        ),
    ):
        results = asyncio.run(auto_transitions.run_due_transitions(session_factory))

    assert results == [{"tournament_id": 5, "status": "skipped", "reason": "registration_form_missing"}]
    transition.assert_not_awaited()


def test_run_due_transitions_opens_registration_once_the_form_exists() -> None:
    announced = SimpleNamespace(
        id=6,
        status=enums.TournamentStatus.ANNOUNCEMENT,
        phase_schedule=[_schedule_row(enums.TournamentStatus.REGISTRATION, timedelta(minutes=-5))],
    )
    sessions = [
        _session_returning(_result_with_ids([6])),
        _session_returning(_result_with_row(announced)),
    ]
    session_factory = Mock(side_effect=[_FakeSessionCtx(s) for s in sessions])

    transition = AsyncMock(return_value=announced)
    with (
        patch.object(auto_transitions.admin_tournament_service, "transition_status", transition),
        patch.object(
            auto_transitions.admin_tournament_service,
            "has_registration_form",
            AsyncMock(return_value=True),
        ),
    ):
        results = asyncio.run(auto_transitions.run_due_transitions(session_factory))

    assert results[0]["status"] == "success"
    assert results[0]["old_status"] == enums.TournamentStatus.ANNOUNCEMENT.value
    assert results[0]["new_status"] == enums.TournamentStatus.REGISTRATION.value


# ─── Real-DB integration tests ───────────────────────────────────────────────


async def _make_workspace(session) -> Workspace:
    suffix = uuid.uuid4().hex[:12]
    workspace = Workspace(
        slug=f"autotrans-test-{suffix}",
        name=f"Auto-Transitions Test {suffix}",
    )
    session.add(workspace)
    await session.flush()
    return workspace


async def _make_tournament(
    session,
    *,
    workspace_id: int,
    status: enums.TournamentStatus = enums.TournamentStatus.REGISTRATION,
    auto_transitions_enabled: bool = True,
) -> Tournament:
    suffix = uuid.uuid4().hex[:12]
    tournament = Tournament(
        workspace_id=workspace_id,
        name=f"Auto-Transitions Tournament {suffix}",
        # NOT NULL and globally unique; production writes go through
        # `generate_unique_tournament_slug`, which this factory bypasses.
        slug=f"autotrans-{suffix}",
        status=status,
        auto_transitions_enabled=auto_transitions_enabled,
    )
    session.add(tournament)
    await session.flush()
    return tournament


async def _add_schedule_row(
    session,
    *,
    tournament_id: int,
    status: enums.TournamentStatus,
    starts_at: datetime,
) -> None:
    session.add(
        TournamentPhaseSchedule(
            tournament_id=tournament_id,
            status=status,
            starts_at=starts_at,
        )
    )
    await session.flush()


async def _tournament_state(session_maker, tournament_id: int) -> tuple[enums.TournamentStatus, bool]:
    """Fresh-session read so internal commits from the tick are visible."""
    async with session_maker() as session:
        row = (
            await session.execute(
                sa.select(Tournament.status, Tournament.auto_transitions_enabled).where(Tournament.id == tournament_id)
            )
        ).one()
        return row.status, row.auto_transitions_enabled


async def _cleanup(session_maker, *, workspace_id: int) -> None:
    """Best-effort teardown: the tick commits internally, so rows survive the
    seeding session — delete the workspace (FK cascade drops the rest)."""
    async with session_maker() as session:
        await session.execute(sa.delete(Workspace).where(Workspace.id == workspace_id))
        await session.commit()


def test_due_tournament_transitions_and_stays_automated() -> None:
    async def _run():
        async with _db_sessions() as session_maker:
            async with session_maker() as session:
                workspace = await _make_workspace(session)
                tournament = await _make_tournament(session, workspace_id=workspace.id)
                await _add_schedule_row(
                    session,
                    tournament_id=tournament.id,
                    status=enums.TournamentStatus.CHECK_IN,
                    starts_at=datetime.now(UTC) - timedelta(minutes=5),
                )
                await session.commit()
                workspace_id, tournament_id = workspace.id, tournament.id

            try:
                results = await auto_transitions.run_due_transitions(session_maker)
                state = await _tournament_state(session_maker, tournament_id)
                ours = [r for r in results if r["tournament_id"] == tournament_id]
                return state, ours
            finally:
                await _cleanup(session_maker, workspace_id=workspace_id)

    (status, auto_enabled), ours = asyncio.run(_run())

    assert status == enums.TournamentStatus.CHECK_IN
    # Automated transitions never flip the tournament into manual mode.
    assert auto_enabled is True
    assert len(ours) == 1
    assert ours[0]["status"] == "success"
    assert ours[0]["new_status"] == enums.TournamentStatus.CHECK_IN.value


def test_paused_and_future_tournaments_untouched() -> None:
    async def _run():
        async with _db_sessions() as session_maker:
            async with session_maker() as session:
                workspace = await _make_workspace(session)
                paused = await _make_tournament(session, workspace_id=workspace.id, auto_transitions_enabled=False)
                await _add_schedule_row(
                    session,
                    tournament_id=paused.id,
                    status=enums.TournamentStatus.CHECK_IN,
                    starts_at=datetime.now(UTC) - timedelta(minutes=5),
                )
                future = await _make_tournament(session, workspace_id=workspace.id)
                await _add_schedule_row(
                    session,
                    tournament_id=future.id,
                    status=enums.TournamentStatus.CHECK_IN,
                    starts_at=datetime.now(UTC) + timedelta(hours=1),
                )
                await session.commit()
                workspace_id, paused_id, future_id = workspace.id, paused.id, future.id

            try:
                results = await auto_transitions.run_due_transitions(session_maker)
                paused_state = await _tournament_state(session_maker, paused_id)
                future_state = await _tournament_state(session_maker, future_id)
                touched = {r["tournament_id"] for r in results}
                return paused_id, future_id, paused_state, future_state, touched
            finally:
                await _cleanup(session_maker, workspace_id=workspace_id)

    paused_id, future_id, paused_state, future_state, touched = asyncio.run(_run())

    assert paused_state == (enums.TournamentStatus.REGISTRATION, False)
    assert future_state == (enums.TournamentStatus.REGISTRATION, True)
    assert paused_id not in touched
    assert future_id not in touched


def test_manual_transition_pauses_automation() -> None:
    async def _run():
        async with _db_sessions() as session_maker:
            async with session_maker() as session:
                workspace = await _make_workspace(session)
                tournament = await _make_tournament(session, workspace_id=workspace.id)
                # A due LIVE row that the tick must NOT act on after the manual pause.
                await _add_schedule_row(
                    session,
                    tournament_id=tournament.id,
                    status=enums.TournamentStatus.LIVE,
                    starts_at=datetime.now(UTC) - timedelta(minutes=1),
                )
                await session.commit()
                workspace_id, tournament_id = workspace.id, tournament.id

            try:
                # Manual transition (automated defaults to False) — commits internally.
                async with session_maker() as session:
                    await admin_tournament_service.tournament_service.transition_status(
                        session,
                        tournament_id,
                        enums.TournamentStatus.CHECK_IN,
                    )
                after_manual = await _tournament_state(session_maker, tournament_id)

                results = await auto_transitions.run_due_transitions(session_maker)
                after_tick = await _tournament_state(session_maker, tournament_id)
                touched = {r["tournament_id"] for r in results}
                return tournament_id, after_manual, after_tick, touched
            finally:
                await _cleanup(session_maker, workspace_id=workspace_id)

    tournament_id, after_manual, after_tick, touched = asyncio.run(_run())

    assert after_manual == (enums.TournamentStatus.CHECK_IN, False)
    # Paused tournament is ignored by the tick despite the overdue LIVE row.
    assert after_tick == (enums.TournamentStatus.CHECK_IN, False)
    assert tournament_id not in touched


# ─── Going LIVE leaves a durable bracket job behind ─────────────────────────


async def _seed_unstarted_group_stage(session, *, auto_transitions_enabled: bool) -> tuple[int, int, int]:
    """CHECK_IN tournament with a seeded, never-generated round-robin stage."""
    workspace = await _make_workspace(session)
    tournament = await _make_tournament(
        session,
        workspace_id=workspace.id,
        status=enums.TournamentStatus.CHECK_IN,
        auto_transitions_enabled=auto_transitions_enabled,
    )
    suffix = uuid.uuid4().hex[:12]
    teams = [Team(tournament_id=tournament.id, name=f"t{i} {suffix}", balancer_name=f"t{i}-{suffix}") for i in range(4)]
    session.add_all(teams)
    stage = Stage(
        tournament_id=tournament.id,
        name="Groups",
        stage_type=enums.StageType.ROUND_ROBIN,
        order=1,
        scoring_rule=ScoringRule(
            workspace_id=workspace.id,
            preset="wins",
            game_formula="win",
            end_formula="games >= best_of or max_wins * 2 > best_of",
        ),
    )
    session.add(stage)
    await session.flush()
    item = StageItem(stage_id=stage.id, name="A", type=enums.StageItemType.GROUP, order=0)
    session.add(item)
    await session.flush()
    session.add_all(
        StageItemInput(stage_item_id=item.id, slot=slot, input_type=enums.StageItemInputType.FINAL, team_id=team.id)
        for slot, team in enumerate(teams, start=1)
    )
    await session.flush()
    return workspace.id, tournament.id, stage.id


async def _bracket_jobs(session_maker, tournament_id: int) -> list[tuple[int, str]]:
    async with session_maker() as session:
        rows = await session.execute(
            sa.select(TournamentComputationJob.stage_id, TournamentComputationJob.operation).where(
                TournamentComputationJob.tournament_id == tournament_id,
                TournamentComputationJob.kind == "bracket",
            )
        )
        return [tuple(row) for row in rows.all()]


async def _cleanup_with_jobs(session_maker, *, workspace_id: int, tournament_id: int) -> None:
    async with session_maker() as session:
        job_ids = (
            await session.scalars(
                sa.select(TournamentComputationJob.id).where(TournamentComputationJob.tournament_id == tournament_id)
            )
        ).all()
        if job_ids:
            await session.execute(
                sa.delete(EventOutbox).where(EventOutbox.payload_json["job_id"].as_integer().in_(job_ids))
            )
        await session.commit()
    await _cleanup(session_maker, workspace_id=workspace_id)


def test_manual_live_transition_persists_the_group_stage_job() -> None:
    """The RPC envelope closes the session without a commit of its own, so the
    job ``transition_status`` requests has to be committed by it."""

    async def _run():
        async with _db_sessions() as session_maker:
            async with session_maker() as session:
                workspace_id, tournament_id, stage_id = await _seed_unstarted_group_stage(
                    session, auto_transitions_enabled=False
                )
                await session.commit()

            try:
                async with session_maker() as session:
                    await admin_tournament_service.tournament_service.transition_status(
                        session, tournament_id, enums.TournamentStatus.LIVE
                    )
                return stage_id, await _bracket_jobs(session_maker, tournament_id)
            finally:
                await _cleanup_with_jobs(session_maker, workspace_id=workspace_id, tournament_id=tournament_id)

    stage_id, jobs = asyncio.run(_run())

    assert jobs == [(stage_id, "activate_and_generate")]


def test_tick_reaching_live_persists_the_group_stage_job() -> None:
    async def _run():
        async with _db_sessions() as session_maker:
            async with session_maker() as session:
                workspace_id, tournament_id, stage_id = await _seed_unstarted_group_stage(
                    session, auto_transitions_enabled=True
                )
                await _add_schedule_row(
                    session,
                    tournament_id=tournament_id,
                    status=enums.TournamentStatus.LIVE,
                    starts_at=datetime.now(UTC) - timedelta(minutes=1),
                )
                await session.commit()

            try:
                await auto_transitions.run_due_transitions(session_maker)
                state = await _tournament_state(session_maker, tournament_id)
                return stage_id, state, await _bracket_jobs(session_maker, tournament_id)
            finally:
                await _cleanup_with_jobs(session_maker, workspace_id=workspace_id, tournament_id=tournament_id)

    stage_id, (status, _), jobs = asyncio.run(_run())

    assert status == enums.TournamentStatus.LIVE
    assert jobs == [(stage_id, "activate_and_generate")]
