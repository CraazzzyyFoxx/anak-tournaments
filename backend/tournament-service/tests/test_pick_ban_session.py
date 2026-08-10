from __future__ import annotations

import os
import re
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest import IsolatedAsyncioTestCase

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "tournament-service"))

os.environ.setdefault("PROJECT_URL", "http://localhost")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("POSTGRES_USER", "postgres")
os.environ.setdefault("POSTGRES_PASSWORD", "postgres")
os.environ.setdefault("POSTGRES_DB", "postgres")
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_PORT", "5432")
os.environ.setdefault("CHALLONGE_USERNAME", "test")
os.environ.setdefault("CHALLONGE_API_KEY", "test")

import sqlalchemy as sa  # noqa: E402

from shared.core.enums import FirstBanRotation, MapVetoMode, PickBanKind  # noqa: E402
from shared.models.tournament.pick_ban import (  # noqa: E402
    EncounterPickBanLedger,
    EncounterReadiness,
    PickBanConfig,
    PickBanEntry,
    PickBanSession,
)
from shared.models.tournament.stage import Stage  # noqa: E402
from src.services.encounter.pick_ban_session import (  # noqa: E402
    REASON_NOT_READY,
    both_sides_ready,
    ensure_pick_ban_session,
    get_pick_ban_session,
    get_readiness,
    mark_ready,
    reset_pick_ban_session,
    reset_readiness,
    sync_all_pick_ban_sessions_after_team_change,
    sync_pick_ban_session_after_team_change,
    unavailable_reason,
)
from src.services.encounter.veto_session import (  # noqa: E402
    REASON_NOT_CONFIGURED,
    REASON_SLOT_COUNT_MISMATCH,
    REASON_SLOT_UNDERFILLED,
    REASON_TEAMS_UNKNOWN,
)


def _slot(position: int, item_ids: list[int], *, reserve: int | None = None) -> SimpleNamespace:
    return SimpleNamespace(
        position=position,
        reserve_item_id=reserve,
        items=[SimpleNamespace(item_id=item_id) for item_id in item_ids],
    )


def _config(
    *,
    kind: PickBanKind = PickBanKind.MAP,
    mode: MapVetoMode = MapVetoMode.SLOTS,
    rotation: str = FirstBanRotation.FIXED,
    items: list[int] | None = None,
    slots: list[SimpleNamespace] | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        id=42,
        kind=kind,
        stage_id=None,
        round=None,
        mode=mode,
        preset="bracket",
        first_ban_rotation=rotation,
        sequence_json=["pick_first", "pick_second"],
        turn_timer_seconds=45,
        no_repeat_scope="none",
        items=[SimpleNamespace(item_id=item_id, sort_order=idx) for idx, item_id in enumerate(items or [])],
        slots=slots or [],
    )


def _encounter(*, best_of: int, home: int | None = 10, away: int | None = 20) -> SimpleNamespace:
    return SimpleNamespace(
        id=500,
        tournament_id=7,
        stage_id=3,
        stage_item_id=None,
        round=2,
        best_of=best_of,
        home_team_id=home,
        away_team_id=away,
    )


class _Result:
    def __init__(self, rows: list[Any]) -> None:
        self._rows = rows

    def scalars(self) -> _Result:
        return self

    def all(self) -> list[Any]:
        return list(self._rows)

    def scalar_one_or_none(self) -> Any:
        return self._rows[0] if self._rows else None


class _FakeSession:
    """Just enough ``AsyncSession`` for ``ensure_pick_ban_session``,
    ``unavailable_reason`` and ``reset_pick_ban_session``. Mirrors
    ``test_veto_session.py``'s ``_FakeSession`` exactly, generalized to the
    ``PickBanConfig``/``PickBanSession`` entities and extended with ``Delete``
    dispatch for the reset path.
    """

    def __init__(
        self,
        *,
        config: Any = None,
        existing: Any = None,
        pool_count: int = 0,
        readiness: frozenset[str] = frozenset({"home", "away"}),
    ) -> None:
        self.config = config
        self.existing = existing
        self.pool_count = pool_count
        # Defaults to "both ready" so every pre-existing test (all written
        # before the readiness gate existed) keeps exercising config/team
        # logic unchanged; only tests that care about the gate pass a
        # narrower set.
        self.readiness = readiness
        self.added: list[Any] = []
        self.deletes: list[Any] = []
        self.commits = 0
        self.flushes = 0

    async def execute(self, statement: Any) -> _Result:
        if isinstance(statement, sa.sql.dml.Delete):
            self.deletes.append(statement)
            if statement.table.name == PickBanSession.__tablename__:
                self.existing = None
            elif statement.table.name == EncounterReadiness.__tablename__:
                self.readiness = frozenset()
            return _Result([])
        entity = statement.column_descriptions[0]["entity"]
        if entity is PickBanSession:
            return _Result([] if self.existing is None else [self.existing])
        if entity is PickBanConfig:
            return _Result([] if self.config is None else [self.config])
        if entity is EncounterReadiness:
            # ``mark_ready`` queries a specific side (``select(EncounterReadiness)
            # .where(..., side == X)``); ``get_readiness`` queries all sides for
            # the encounter (no side filter). Distinguish by sniffing the
            # compiled WHERE clause -- there's no ORM-level "which side" the
            # fake can otherwise read off an opaque ``Select``.
            compiled = str(statement.compile(compile_kwargs={"literal_binds": True}))
            side_match = re.search(r"side = '(\w+)'", compiled)
            if side_match:
                side = side_match.group(1)
                return _Result([side] if side in self.readiness else [])
            return _Result(sorted(self.readiness))
        raise AssertionError(f"unexpected execute() entity: {entity}")

    async def scalar(self, statement: Any) -> Any:
        entity = statement.column_descriptions[0]["entity"]
        if entity is None:
            return self.pool_count
        if entity is Stage:
            return None
        raise AssertionError(f"unexpected scalar() entity: {entity}")

    def add(self, instance: Any) -> None:
        self.added.append(instance)
        if isinstance(instance, EncounterReadiness):
            self.readiness = self.readiness | {instance.side}

    async def flush(self) -> None:
        self.flushes += 1

    async def commit(self) -> None:
        self.commits += 1

    async def rollback(self) -> None:  # pragma: no cover - no IntegrityError here
        return None

    @property
    def pool_rows(self) -> list[PickBanEntry]:
        return [row for row in self.added if isinstance(row, PickBanEntry)]

    def deleted_tables(self) -> list[str]:
        return [stmt.table.name for stmt in self.deletes]


class EnsurePickBanSessionSlotReservesTests(IsolatedAsyncioTestCase):
    """``slot_reserves_json`` on the created session -- the parity gap the
    generic engine had against ``EncounterVetoSession.slot_reserves_json``."""

    async def test_slot_mode_snapshots_reserves_for_in_play_slots_only(self) -> None:
        config = _config(
            slots=[
                _slot(1, [11, 12]),
                _slot(2, [21, 22, 23], reserve=99),
                _slot(3, [31, 32], reserve=98),  # out of play at best_of=2
            ]
        )
        session = _FakeSession(config=config)

        pick_ban = await ensure_pick_ban_session(session, _encounter(best_of=2), PickBanKind.MAP)

        assert pick_ban is not None
        self.assertEqual({"2": 99}, pick_ban.slot_reserves_json)

    async def test_flat_mode_has_no_reserve_snapshot(self) -> None:
        config = _config(mode=MapVetoMode.POOL, items=[11, 12, 13, 14, 15])
        session = _FakeSession(config=config)

        pick_ban = await ensure_pick_ban_session(session, _encounter(best_of=3), PickBanKind.MAP)

        assert pick_ban is not None
        self.assertIsNone(pick_ban.slot_reserves_json)

    async def test_no_reserves_is_an_empty_snapshot_not_none(self) -> None:
        config = _config(slots=[_slot(1, [11, 12]), _slot(2, [21, 22])])
        session = _FakeSession(config=config)

        pick_ban = await ensure_pick_ban_session(session, _encounter(best_of=2), PickBanKind.MAP)

        assert pick_ban is not None
        self.assertEqual({}, pick_ban.slot_reserves_json)


class EnsurePickBanSessionSlotCountMismatchTests(IsolatedAsyncioTestCase):
    """Pins the fix for a tautological check: ``len(list[:n]) < min(len(list),
    n)`` is never true, so the pre-existing mismatch guard never refused a
    series longer than the config's slot count. The real condition is
    ``best_of > len(config.slots)``."""

    async def test_best_of_longer_than_the_slot_count_refuses(self) -> None:
        config = _config(slots=[_slot(1, [11, 12]), _slot(2, [21, 22])])
        session = _FakeSession(config=config)

        pick_ban = await ensure_pick_ban_session(session, _encounter(best_of=3), PickBanKind.MAP)

        self.assertIsNone(pick_ban)
        self.assertEqual([], session.pool_rows)

    async def test_best_of_equal_to_the_slot_count_is_playable(self) -> None:
        config = _config(slots=[_slot(1, [11, 12]), _slot(2, [21, 22])])
        session = _FakeSession(config=config)

        pick_ban = await ensure_pick_ban_session(session, _encounter(best_of=2), PickBanKind.MAP)

        self.assertIsNotNone(pick_ban)

    async def test_a_config_with_no_slots_refuses(self) -> None:
        config = _config(slots=[])
        session = _FakeSession(config=config)

        pick_ban = await ensure_pick_ban_session(session, _encounter(best_of=1), PickBanKind.MAP)

        self.assertIsNone(pick_ban)


class UnavailableReasonTests(IsolatedAsyncioTestCase):
    """Kind-aware reason derivation against ``PickBanConfig`` -- fixes the bug
    where ``get_pick_ban_state`` used to call the legacy, kind-blind
    ``veto_session.unavailable_reason`` (which resolves ``MapVetoConfig``
    regardless of ``kind``)."""

    async def test_unknown_teams_short_circuit_before_any_query(self) -> None:
        session = _FakeSession()

        reason = await unavailable_reason(session, _encounter(best_of=3, away=None), PickBanKind.MAP)

        self.assertEqual(REASON_TEAMS_UNKNOWN, reason)

    async def test_no_config_is_not_configured(self) -> None:
        session = _FakeSession(config=None)

        reason = await unavailable_reason(session, _encounter(best_of=3), PickBanKind.HERO)

        self.assertEqual(REASON_NOT_CONFIGURED, reason)

    async def test_more_rounds_than_slots_is_slot_count_mismatch(self) -> None:
        config = _config(slots=[_slot(1, [11, 12]), _slot(2, [21, 22, 23])])
        session = _FakeSession(config=config)

        reason = await unavailable_reason(session, _encounter(best_of=3), PickBanKind.MAP)

        self.assertEqual(REASON_SLOT_COUNT_MISMATCH, reason)

    async def test_an_underfilled_slot_in_play_is_slot_underfilled(self) -> None:
        config = _config(slots=[_slot(1, [11, 12]), _slot(2, [21])])
        session = _FakeSession(config=config)

        reason = await unavailable_reason(session, _encounter(best_of=2), PickBanKind.MAP)

        self.assertEqual(REASON_SLOT_UNDERFILLED, reason)

    async def test_a_playable_flat_config_reports_not_configured(self) -> None:
        config = _config(mode=MapVetoMode.POOL, items=[11, 12, 13])
        session = _FakeSession(config=config)

        reason = await unavailable_reason(session, _encounter(best_of=9), PickBanKind.MAP)

        self.assertEqual(REASON_NOT_CONFIGURED, reason)

    async def test_the_two_slot_reasons_are_distinct_strings(self) -> None:
        self.assertNotEqual(REASON_SLOT_COUNT_MISMATCH, REASON_SLOT_UNDERFILLED)
        self.assertNotIn(REASON_SLOT_COUNT_MISMATCH, {REASON_NOT_CONFIGURED, REASON_TEAMS_UNKNOWN})


class ResetPickBanSessionTests(IsolatedAsyncioTestCase):
    """Delete + re-create, mirroring ``veto_session.reset_veto_session``:
    the entries are not separately deleted here because
    ``pick_ban_entry.session_id`` carries ``ON DELETE CASCADE`` at the DB
    level (unlike legacy ``encounter_map_pool``, which is keyed by
    ``encounter_id`` and needs its own bulk delete)."""

    async def test_deletes_the_existing_session_and_its_kind_scoped_ledger(self) -> None:
        existing = SimpleNamespace(id=900)
        session = _FakeSession(existing=existing, config=None)  # no config -> re-ensure no-ops

        result = await reset_pick_ban_session(session, _encounter(best_of=3), PickBanKind.MAP)

        self.assertIsNone(result)
        self.assertEqual(
            {PickBanSession.__tablename__, EncounterPickBanLedger.__tablename__},
            set(session.deleted_tables()),
        )
        self.assertEqual(1, session.flushes)
        self.assertEqual(1, session.commits)

    async def test_no_existing_session_still_clears_the_ledger_and_recreates(self) -> None:
        session = _FakeSession(existing=None, config=_config(mode=MapVetoMode.POOL, items=[11, 12, 13]))

        pick_ban = await reset_pick_ban_session(session, _encounter(best_of=3), PickBanKind.MAP)

        self.assertIsNotNone(pick_ban)
        # Only the ledger delete fires -- there was no session row to delete.
        self.assertEqual([EncounterPickBanLedger.__tablename__], session.deleted_tables())

    async def test_commit_false_flushes_instead_of_committing(self) -> None:
        session = _FakeSession(existing=None, config=_config(mode=MapVetoMode.POOL, items=[11, 12, 13]))

        await reset_pick_ban_session(session, _encounter(best_of=3), PickBanKind.MAP, commit=False)

        self.assertEqual(0, session.commits)
        self.assertGreaterEqual(session.flushes, 1)


class GetPickBanSessionScopingTests(IsolatedAsyncioTestCase):
    async def test_returns_none_when_nothing_exists(self) -> None:
        session = _FakeSession()

        self.assertIsNone(await get_pick_ban_session(session, 500, PickBanKind.MAP))


class SyncPickBanSessionAfterTeamChangeTests(IsolatedAsyncioTestCase):
    """Mirrors ``veto_session.sync_veto_session_after_team_change``'s three
    branches exactly."""

    async def test_no_session_and_both_teams_known_creates_one(self) -> None:
        config = _config(mode=MapVetoMode.POOL, items=[11, 12, 13])
        session = _FakeSession(existing=None, config=config)

        await sync_pick_ban_session_after_team_change(session, _encounter(best_of=3), PickBanKind.MAP)

        self.assertEqual(3, len(session.pool_rows))
        self.assertEqual(0, session.commits)  # ensure_pick_ban_session is called with commit=False here

    async def test_no_session_and_teams_still_unknown_is_a_no_op(self) -> None:
        session = _FakeSession(existing=None, config=None)

        await sync_pick_ban_session_after_team_change(session, _encounter(best_of=3, home=None), PickBanKind.MAP)

        self.assertEqual([], session.pool_rows)

    async def test_an_existing_session_with_a_played_entry_is_left_alone(self) -> None:
        existing = SimpleNamespace(id=900)
        session = _FakeSession(existing=existing, pool_count=1)

        await sync_pick_ban_session_after_team_change(session, _encounter(best_of=3), PickBanKind.MAP)

        self.assertEqual([], session.deleted_tables())

    async def test_an_existing_session_with_no_played_entries_is_reset(self) -> None:
        existing = SimpleNamespace(id=900)
        session = _FakeSession(existing=existing, pool_count=0, config=None)

        await sync_pick_ban_session_after_team_change(session, _encounter(best_of=3), PickBanKind.MAP)

        self.assertIn(PickBanSession.__tablename__, session.deleted_tables())


class ReadinessGateTests(IsolatedAsyncioTestCase):
    """``ensure_pick_ban_session``/``unavailable_reason`` refuse to create or
    explain a session as available until ``EncounterReadiness`` has both
    sides -- checked only once teams/config/slots are otherwise fine, so it
    never masks a more specific reason."""

    async def test_ensure_returns_none_when_readiness_incomplete(self) -> None:
        config = _config(mode=MapVetoMode.POOL, items=[11, 12, 13])
        session = _FakeSession(config=config, readiness=frozenset({"home"}))

        pick_ban = await ensure_pick_ban_session(session, _encounter(best_of=3), PickBanKind.MAP)

        self.assertIsNone(pick_ban)
        self.assertEqual([], session.pool_rows)

    async def test_ensure_returns_none_when_no_side_ready(self) -> None:
        config = _config(mode=MapVetoMode.POOL, items=[11, 12, 13])
        session = _FakeSession(config=config, readiness=frozenset())

        pick_ban = await ensure_pick_ban_session(session, _encounter(best_of=3), PickBanKind.MAP)

        self.assertIsNone(pick_ban)

    async def test_ensure_creates_once_both_sides_ready(self) -> None:
        config = _config(mode=MapVetoMode.POOL, items=[11, 12, 13])
        session = _FakeSession(config=config, readiness=frozenset({"home", "away"}))

        pick_ban = await ensure_pick_ban_session(session, _encounter(best_of=3), PickBanKind.MAP)

        self.assertIsNotNone(pick_ban)
        self.assertEqual(3, len(session.pool_rows))

    async def test_unavailable_reason_is_not_ready_when_config_valid_but_unready(self) -> None:
        config = _config(mode=MapVetoMode.POOL, items=[11, 12, 13])
        session = _FakeSession(config=config, readiness=frozenset({"home"}))

        reason = await unavailable_reason(session, _encounter(best_of=3), PickBanKind.MAP)

        self.assertEqual(REASON_NOT_READY, reason)

    async def test_unavailable_reason_prefers_teams_unknown_over_not_ready(self) -> None:
        session = _FakeSession(config=None, readiness=frozenset())

        reason = await unavailable_reason(session, _encounter(best_of=3, home=None), PickBanKind.MAP)

        self.assertEqual(REASON_TEAMS_UNKNOWN, reason)

    async def test_unavailable_reason_prefers_not_configured_over_not_ready(self) -> None:
        session = _FakeSession(config=None, readiness=frozenset())

        reason = await unavailable_reason(session, _encounter(best_of=3), PickBanKind.MAP)

        self.assertEqual(REASON_NOT_CONFIGURED, reason)


class ReadinessHelperTests(IsolatedAsyncioTestCase):
    """``get_readiness``/``both_sides_ready``/``mark_ready``/``reset_readiness``
    in isolation from the session-creation gate above."""

    async def test_get_readiness_reports_each_side_independently(self) -> None:
        session = _FakeSession(readiness=frozenset({"home"}))

        readiness = await get_readiness(session, 500)

        self.assertEqual({"home": True, "away": False}, readiness)

    async def test_both_sides_ready_requires_both(self) -> None:
        self.assertFalse(await both_sides_ready(_FakeSession(readiness=frozenset({"home"})), 500))
        self.assertTrue(await both_sides_ready(_FakeSession(readiness=frozenset({"home", "away"})), 500))

    async def test_mark_ready_is_idempotent_and_returns_full_map(self) -> None:
        session = _FakeSession(readiness=frozenset())

        first = await mark_ready(session, _encounter(best_of=3), "home", 42)
        self.assertEqual({"home": True, "away": False}, first)
        self.assertEqual(1, session.commits)

        # Re-confirming the same side does not add a second row or re-commit
        # needlessly -- it just reflects the (unchanged) state back.
        second = await mark_ready(session, _encounter(best_of=3), "home", 42)
        self.assertEqual({"home": True, "away": False}, second)
        self.assertEqual(1, session.commits)

        third = await mark_ready(session, _encounter(best_of=3), "away", 99)
        self.assertEqual({"home": True, "away": True}, third)
        self.assertEqual(2, session.commits)

    async def test_reset_readiness_clears_both_sides(self) -> None:
        session = _FakeSession(readiness=frozenset({"home", "away"}))

        await reset_readiness(session, 500)

        self.assertEqual({"home": False, "away": False}, await get_readiness(session, 500))
        self.assertIn(EncounterReadiness.__tablename__, session.deleted_tables())


class SyncAllPickBanSessionsAfterTeamChangeTests(IsolatedAsyncioTestCase):
    """The two-kind, legacy-shape wrapper additionally clears readiness --
    a confirmation made against one opponent must not carry over once the
    team assignment changes."""

    async def test_clears_readiness_alongside_both_kinds(self) -> None:
        config = _config(mode=MapVetoMode.POOL, items=[11, 12, 13])
        session = _FakeSession(existing=None, config=config, readiness=frozenset({"home", "away"}))

        await sync_all_pick_ban_sessions_after_team_change(session, _encounter(best_of=3))

        self.assertEqual({"home": False, "away": False}, await get_readiness(session, 500))
