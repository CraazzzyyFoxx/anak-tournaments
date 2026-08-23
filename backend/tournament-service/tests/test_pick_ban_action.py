from __future__ import annotations

import os
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase, TestCase
from unittest.mock import patch

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

from shared.core.enums import MapPickSide, MapPoolEntryStatus, MapVetoSessionStatus, PickBanKind  # noqa: E402
from shared.core.errors import BaseAPIException as HTTPException  # noqa: E402
from src.services.encounter import pick_ban_action  # noqa: E402
from src.services.encounter.pick_ban_action import (  # noqa: E402
    apply_pick_ban_action,
    auto_complete_decider_entry,
    pick_ban_action_service,
    serialize_pick_ban_session,
)


def make_entry(
    item_id: int,
    *,
    status: MapPoolEntryStatus = MapPoolEntryStatus.AVAILABLE,
    order: int = 0,
    action_index: int | None = None,
    picked_by: MapPickSide | None = None,
    protected_by: MapPickSide | None = None,
    round: int | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        id=item_id,
        item_id=item_id,
        order=order,
        action_index=action_index,
        status=status,
        picked_by=picked_by,
        protected_by=protected_by,
        round=round,
    )


class AutoCompleteDeciderEntryTests(TestCase):
    """Generalizes ``map_veto.auto_complete_decider_entry``'s own suite:
    ``slot`` -> ``round``, ``map_id`` -> ``item_id``."""

    def test_marks_last_available_item_as_decider_pick(self) -> None:
        pool = [
            make_entry(1, status=MapPoolEntryStatus.BANNED, picked_by=MapPickSide.HOME, order=0),
            make_entry(2, status=MapPoolEntryStatus.PICKED, picked_by=MapPickSide.AWAY, order=1),
            make_entry(3, status=MapPoolEntryStatus.AVAILABLE, order=2),
        ]

        resolved = auto_complete_decider_entry(["ban_home", "pick_away", "decider"], pool)

        self.assertIsNotNone(resolved)
        self.assertEqual(MapPoolEntryStatus.PICKED.value, resolved.status)
        self.assertEqual(MapPickSide.DECIDER.value, resolved.picked_by)
        self.assertEqual(2, resolved.order)
        self.assertEqual(2, resolved.action_index)

    def test_no_pending_decider_step_returns_none(self) -> None:
        pool = [make_entry(1, status=MapPoolEntryStatus.AVAILABLE)]

        self.assertIsNone(auto_complete_decider_entry(["ban_home"], pool))

    def test_sequence_already_complete_returns_none(self) -> None:
        pool = [make_entry(1, status=MapPoolEntryStatus.BANNED, picked_by=MapPickSide.HOME)]

        self.assertIsNone(auto_complete_decider_entry(["ban_home"], pool))

    def test_round_scoped_decider_ignores_other_rounds_candidates(self) -> None:
        """The decider closes one round at a time: another round's untouched
        candidates must not count toward this round's "exactly one
        available". A whole-pool count would see 4 available (1 in round 1,
        3 in round 2) and 400 instead of resolving round 1's decider."""
        pool = [
            make_entry(1, round=1, status=MapPoolEntryStatus.BANNED),
            make_entry(2, round=1, status=MapPoolEntryStatus.BANNED),
            make_entry(3, round=1),
            make_entry(4, round=2),
            make_entry(5, round=2),
            make_entry(6, round=2),
        ]
        sequence = ["ban_home", "ban_away", "decider", "ban_home", "ban_away", "decider"]

        entry = auto_complete_decider_entry(sequence, pool)

        self.assertEqual(3, entry.item_id)
        self.assertEqual(MapPoolEntryStatus.PICKED.value, entry.status)

    def test_zero_available_candidates_raises(self) -> None:
        pool = [
            make_entry(1, status=MapPoolEntryStatus.BANNED, picked_by=MapPickSide.HOME),
            make_entry(2, status=MapPoolEntryStatus.BANNED, picked_by=MapPickSide.AWAY),
        ]

        with self.assertRaises(HTTPException) as ctx:
            auto_complete_decider_entry(["ban_home", "ban_away", "decider"], pool)
        self.assertEqual(400, ctx.exception.status_code)
        self.assertEqual("Decider step has no available item", ctx.exception.detail)

    def test_multiple_available_candidates_picks_one_at_random(self) -> None:
        """A pool oversized for its series length (config mistake, not a
        captain's) must not 400 the room dead forever -- it resolves the
        decider the same way an abandoned captain step already does:
        uniformly at random among the survivors, leaving the rest untouched,
        and every survivor gets a turn across enough draws."""
        chosen_ids: set[int] = set()
        for _ in range(50):
            pool = [
                make_entry(1, status=MapPoolEntryStatus.AVAILABLE),
                make_entry(2, status=MapPoolEntryStatus.AVAILABLE),
                make_entry(3, status=MapPoolEntryStatus.AVAILABLE),
            ]

            entry = auto_complete_decider_entry(["decider"], pool)

            self.assertIn(entry, pool)
            self.assertEqual(MapPoolEntryStatus.PICKED.value, entry.status)
            self.assertEqual(MapPickSide.DECIDER.value, entry.picked_by)
            untouched = [candidate for candidate in pool if candidate is not entry]
            self.assertEqual(2, len(untouched))
            for candidate in untouched:
                self.assertEqual(MapPoolEntryStatus.AVAILABLE, candidate.status)
            chosen_ids.add(entry.item_id)

        self.assertEqual({1, 2, 3}, chosen_ids)

    def test_protected_entries_still_count_as_available_for_the_floor(self) -> None:
        # `protected_by` only blocks a `ban`; a decider auto-resolve does not
        # go through `is_entry_bannable`, so a protected-but-AVAILABLE entry is
        # exactly as eligible as any other survivor.
        pool = [make_entry(1, status=MapPoolEntryStatus.AVAILABLE, protected_by=MapPickSide.HOME)]

        entry = auto_complete_decider_entry(["decider"], pool)

        self.assertEqual(1, entry.item_id)


class _FakeAutoCompleteSession:
    """Just enough ``AsyncSession`` for the self-healing resolvers.

    Both of them re-read the session row and its pool once their cheap check
    says there is work — that re-read is where the ``FOR UPDATE`` lives — so the
    double has to answer it. ``pick_ban``/``pool`` are the stored state; passing
    them to the resolver as well only supplies its unlocked pre-check.
    """

    def __init__(self, pick_ban: object | None = None, pool: list | None = None) -> None:
        self.commits = 0
        self.refreshed: list[object] = []
        self.pick_ban = pick_ban
        self.pool = pool if pool is not None else []

    async def execute(self, statement: object) -> object:
        entity = statement.column_descriptions[0]["entity"]
        name = getattr(entity, "__name__", "")
        if name == "PickBanEntry":
            rows = list(self.pool)
        elif name == "PickBanSession":
            rows = [self.pick_ban]
        else:
            # The config read: this double holds no PickBanConfig, i.e. a session
            # with neither attribute-uniqueness nor cross-round ban memory.
            rows = []
        rows = [row for row in rows if row is not None]

        class _Result:
            def unique(self_inner) -> object:
                return self_inner

            def scalars(self_inner) -> object:
                return self_inner

            def first(self_inner) -> object | None:
                return rows[0] if rows else None

            def all(self_inner) -> list:
                return list(rows)

        return _Result()

    async def commit(self) -> None:
        self.commits += 1

    async def refresh(self, instance: object) -> None:
        self.refreshed.append(instance)


class AutoCompleteDeciderTests(IsolatedAsyncioTestCase):
    async def test_resolves_and_commits_when_a_decider_is_pending(self) -> None:
        pick_ban = SimpleNamespace(
            id=1,
            resolved_sequence_json=["ban_home", "ban_away", "decider"],
            status=MapVetoSessionStatus.ACTIVE.value,
            current_step_started_at=None,
        )
        pool = [
            make_entry(1, status=MapPoolEntryStatus.BANNED, picked_by=MapPickSide.HOME),
            make_entry(2, status=MapPoolEntryStatus.BANNED, picked_by=MapPickSide.AWAY),
            make_entry(3, status=MapPoolEntryStatus.AVAILABLE),
        ]
        session = _FakeAutoCompleteSession(pick_ban, pool)

        entry = await pick_ban_action_service.auto_complete_decider(session, 500, PickBanKind.MAP, pick_ban=pick_ban, pool=pool)

        self.assertIsNotNone(entry)
        self.assertEqual(3, entry.item_id)
        self.assertEqual(MapVetoSessionStatus.COMPLETED.value, pick_ban.status)
        self.assertEqual(1, session.commits)
        self.assertIn(entry, session.refreshed)

    async def test_inactive_session_is_a_no_op(self) -> None:
        pick_ban = SimpleNamespace(
            id=1,
            resolved_sequence_json=["decider"],
            status=MapVetoSessionStatus.COMPLETED.value,
            current_step_started_at=None,
        )
        session = _FakeAutoCompleteSession(pick_ban)

        entry = await pick_ban_action_service.auto_complete_decider(session, 500, PickBanKind.MAP, pick_ban=pick_ban, pool=[make_entry(1)])

        self.assertIsNone(entry)
        self.assertEqual(0, session.commits)

    async def test_no_session_is_a_no_op(self) -> None:
        session = _FakeAutoCompleteSession()

        entry = await pick_ban_action_service.auto_complete_decider(session, 500, PickBanKind.MAP, pick_ban=None, pool=[])

        self.assertIsNone(entry)
        self.assertEqual(0, session.commits)

    async def test_not_yet_at_a_decider_step_is_a_no_op(self) -> None:
        pick_ban = SimpleNamespace(
            id=1,
            resolved_sequence_json=["ban_home", "decider"],
            status=MapVetoSessionStatus.ACTIVE.value,
            current_step_started_at=None,
        )
        session = _FakeAutoCompleteSession(pick_ban)

        entry = await pick_ban_action_service.auto_complete_decider(
            session,
            500,
            PickBanKind.MAP,
            pick_ban=pick_ban,
            pool=[make_entry(1), make_entry(2)],
        )

        self.assertIsNone(entry)
        self.assertEqual(0, session.commits)

    async def test_a_stale_reader_no_longer_awards_the_decider_twice(self) -> None:
        """Same race, same shape: the survivor is a committed step too, so two
        readers resolving it would consume two positions of the sequence. The
        award is decided under the lock against a re-read, so a caller holding
        the pre-award pool finds nothing to do."""
        stored = SimpleNamespace(
            id=1,
            resolved_sequence_json=["ban_home", "decider", "ban_home"],
            status=MapVetoSessionStatus.ACTIVE.value,
            current_step_started_at=None,
        )
        pool = [
            make_entry(1, status=MapPoolEntryStatus.BANNED, picked_by=MapPickSide.HOME, action_index=0),
            make_entry(2),
            make_entry(3),
        ]
        session = _FakeAutoCompleteSession(stored, pool)
        stale_pool = [SimpleNamespace(**vars(candidate)) for candidate in pool]

        awarded = await pick_ban_action_service.auto_complete_decider(session, 500, PickBanKind.MAP, pick_ban=stored, pool=pool)
        self.assertIsNotNone(awarded)
        commits = session.commits

        second = await pick_ban_action_service.auto_complete_decider(session, 500, PickBanKind.MAP, pick_ban=stored, pool=stale_pool)

        self.assertIsNone(second)
        self.assertEqual(commits, session.commits)
        self.assertEqual(1, len([e for e in pool if e.status == MapPoolEntryStatus.PICKED.value]))


class AutoResolveTimeoutTests(IsolatedAsyncioTestCase):
    """``auto_resolve_timeout`` stands in for a captain who let their turn
    timer run out: it picks uniformly at random among every candidate the
    step's action would otherwise accept, then chains into
    ``auto_complete_decider`` the same way ``perform_pick_ban_action`` does."""

    def _expired_pick_ban(self, sequence: list[str], *, timer: int | None = 30) -> SimpleNamespace:
        return SimpleNamespace(
            id=1,
            resolved_sequence_json=sequence,
            status=MapVetoSessionStatus.ACTIVE.value,
            turn_timer_seconds=timer,
            current_step_started_at=datetime.now(UTC) - timedelta(seconds=(timer or 0) + 1),
            config_id=None,
        )

    async def test_auto_bans_a_random_available_item_once_expired(self) -> None:
        pick_ban = self._expired_pick_ban(["ban_home", "decider"])
        pool = [make_entry(1), make_entry(2)]
        session = _FakeAutoCompleteSession(pick_ban, pool)

        entry = await pick_ban_action_service.auto_resolve_timeout(session, 500, PickBanKind.MAP, pick_ban=pick_ban)

        self.assertIsNotNone(entry)
        self.assertEqual(MapPoolEntryStatus.BANNED.value, entry.status)
        self.assertEqual("home", entry.picked_by)
        self.assertIn(entry.item_id, (1, 2))
        # The ban leaves exactly one candidate, so the chained
        # `auto_complete_decider` call resolves the round in the same pass.
        survivor = next(e for e in pool if e.item_id != entry.item_id)
        self.assertEqual(MapPoolEntryStatus.PICKED.value, survivor.status)
        self.assertEqual(MapPickSide.DECIDER.value, survivor.picked_by)
        self.assertEqual(MapVetoSessionStatus.COMPLETED.value, pick_ban.status)

    async def test_not_yet_expired_is_a_no_op(self) -> None:
        pick_ban = SimpleNamespace(
            id=1,
            resolved_sequence_json=["ban_home", "decider"],
            status=MapVetoSessionStatus.ACTIVE.value,
            turn_timer_seconds=30,
            current_step_started_at=datetime.now(UTC),
            config_id=None,
        )
        pool = [make_entry(1), make_entry(2)]
        session = _FakeAutoCompleteSession(pick_ban, pool)

        entry = await pick_ban_action_service.auto_resolve_timeout(session, 500, PickBanKind.MAP, pick_ban=pick_ban)

        self.assertIsNone(entry)
        self.assertEqual(0, session.commits)
        self.assertTrue(all(e.status == MapPoolEntryStatus.AVAILABLE.value for e in pool))

    async def test_no_timer_configured_is_a_no_op(self) -> None:
        pick_ban = SimpleNamespace(
            id=1,
            resolved_sequence_json=["ban_home", "decider"],
            status=MapVetoSessionStatus.ACTIVE.value,
            turn_timer_seconds=None,
            current_step_started_at=datetime.now(UTC) - timedelta(days=1),
            config_id=None,
        )
        pool = [make_entry(1), make_entry(2)]
        session = _FakeAutoCompleteSession(pick_ban, pool)

        entry = await pick_ban_action_service.auto_resolve_timeout(session, 500, PickBanKind.MAP, pick_ban=pick_ban)

        self.assertIsNone(entry)
        self.assertEqual(0, session.commits)

    async def test_inactive_session_is_a_no_op(self) -> None:
        pick_ban = self._expired_pick_ban(["ban_home", "decider"])
        pick_ban.status = MapVetoSessionStatus.COMPLETED.value
        session = _FakeAutoCompleteSession(pick_ban, [make_entry(1), make_entry(2)])

        entry = await pick_ban_action_service.auto_resolve_timeout(session, 500, PickBanKind.MAP, pick_ban=pick_ban)

        self.assertIsNone(entry)
        self.assertEqual(0, session.commits)

    async def test_decider_step_is_out_of_scope(self) -> None:
        """A decider has no captain to time out -- `auto_complete_decider`
        owns it, unconditionally, not this function."""
        pick_ban = self._expired_pick_ban(["decider"])
        pool = [make_entry(1)]
        session = _FakeAutoCompleteSession(pick_ban, pool)

        entry = await pick_ban_action_service.auto_resolve_timeout(session, 500, PickBanKind.MAP, pick_ban=pick_ban)

        self.assertIsNone(entry)
        self.assertEqual(0, session.commits)
        self.assertEqual(MapPoolEntryStatus.AVAILABLE.value, pool[0].status)

    async def test_only_the_side_on_the_clock_is_picked(self) -> None:
        pick_ban = self._expired_pick_ban(["ban_away", "ban_home", "decider"])
        pool = [make_entry(1), make_entry(2), make_entry(3)]
        session = _FakeAutoCompleteSession(pick_ban, pool)

        entry = await pick_ban_action_service.auto_resolve_timeout(session, 500, PickBanKind.MAP, pick_ban=pick_ban)

        self.assertIsNotNone(entry)
        self.assertEqual("away", entry.picked_by)

    async def test_skips_a_protected_candidate_when_banning(self) -> None:
        pick_ban = self._expired_pick_ban(["protect_away", "ban_home", "decider"])
        pool = [
            make_entry(1, status=MapPoolEntryStatus.PROTECTED, protected_by=MapPickSide.AWAY),
            make_entry(2),
            make_entry(3),
        ]
        session = _FakeAutoCompleteSession(pick_ban, pool)

        entry = await pick_ban_action_service.auto_resolve_timeout(session, 500, PickBanKind.MAP, pick_ban=pick_ban)

        self.assertIsNotNone(entry)
        self.assertIn(entry.item_id, (2, 3))

    async def test_a_stale_reader_no_longer_re_resolves_the_same_turn(self) -> None:
        """The room is polled by every client in it, and they all refetch at
        once on a realtime event. One expired turn was therefore resolved by
        every reader that got its read in before the first commit -- each
        auto-action landing on the SAME side and eating the opposite side's
        next step. The resolver now decides under the session lock, against a
        re-read: a reader holding a pre-commit snapshot finds the clock already
        bumped and does nothing."""
        stored = self._expired_pick_ban(["ban_home", "ban_away", "decider"])
        pool = [make_entry(1), make_entry(2), make_entry(3)]
        session = _FakeAutoCompleteSession(stored, pool)
        stale = SimpleNamespace(**vars(stored))

        self.assertIsNotNone(await pick_ban_action_service.auto_resolve_timeout(session, 500, PickBanKind.MAP, pick_ban=stored))
        commits = session.commits

        self.assertIsNone(await pick_ban_action_service.auto_resolve_timeout(session, 500, PickBanKind.MAP, pick_ban=stale))
        self.assertEqual(commits, session.commits)
        self.assertEqual(1, len([e for e in pool if e.status == MapPoolEntryStatus.BANNED.value]))


class _StopAfterLookup(Exception):
    """Cuts a service short the moment it has asked for its session row."""


class SessionLockContractTests(IsolatedAsyncioTestCase):
    """Every path that COMMITS a step must ask for the session row locked.

    White-box on purpose: the lock is the whole correctness argument, and a
    committing path that quietly drops ``for_update`` reintroduces the raced
    step with no other visible symptom until a room comes out lopsided.
    """

    async def _for_update_flag(self, run) -> list[bool]:
        seen: list[bool] = []

        async def spy(_session, _encounter_id, _kind, *, for_update: bool = False):
            seen.append(for_update)
            raise _StopAfterLookup

        with patch.object(pick_ban_action.pick_ban_session_service, "get_pick_ban_session", spy):
            with self.assertRaises(_StopAfterLookup):
                await run()
        return seen

    async def test_the_captain_act_path_locks_before_it_reads_anything(self) -> None:
        flags = await self._for_update_flag(
            lambda: pick_ban_action_service.perform_pick_ban_action(
                _FakeAutoCompleteSession(), 500, PickBanKind.MAP, "home", 1, "ban"
            )
        )

        self.assertEqual([True], flags)


class ApplyPickBanActionUniquenessTests(TestCase):
    """``unique_attribute_per_side_per_round`` is scoped PER ACTION KIND: a
    side's bans constrain its bans and its protects constrain its protects,
    never each other. Banning a tank used to spend that side's tank protect
    too, because both statuses were counted into one history."""

    ROLES = {101: "tank", 102: "tank", 103: "support"}

    def _apply(self, sequence: list[str], pool: list, *, item_id: int, action: str):
        pick_ban = SimpleNamespace(
            resolved_sequence_json=sequence,
            status=MapVetoSessionStatus.ACTIVE.value,
            current_step_started_at=None,
        )
        return apply_pick_ban_action(
            pick_ban,
            pool,
            captain_side="home",
            item_id=item_id,
            action=action,
            attribute_lookup=self.ROLES,
            unique_attribute="role",
            now=datetime.now(UTC),
        )

    def _pool(self, *, first_status: MapPoolEntryStatus) -> list:
        """101 (tank) already committed by home; 102 (tank) and 103 (support)
        still open."""
        first = make_entry(101, status=first_status, action_index=0, round=1)
        if first_status == MapPoolEntryStatus.BANNED:
            first.picked_by = MapPickSide.HOME
        else:
            first.protected_by = MapPickSide.HOME
        return [first, make_entry(102, round=1), make_entry(103, round=1)]

    def test_protect_allowed_after_the_same_side_banned_that_role(self) -> None:
        pool = self._pool(first_status=MapPoolEntryStatus.BANNED)

        entry = self._apply(["ban_home", "protect_home", "decider"], pool, item_id=102, action="protect")

        self.assertEqual(MapPoolEntryStatus.PROTECTED.value, entry.status)
        self.assertEqual("home", entry.protected_by)

    def test_ban_allowed_after_the_same_side_protected_that_role(self) -> None:
        pool = self._pool(first_status=MapPoolEntryStatus.PROTECTED)

        entry = self._apply(["protect_home", "ban_home", "decider"], pool, item_id=102, action="ban")

        self.assertEqual(MapPoolEntryStatus.BANNED.value, entry.status)
        self.assertEqual("home", entry.picked_by)

    def test_second_ban_of_the_same_role_is_still_rejected(self) -> None:
        pool = self._pool(first_status=MapPoolEntryStatus.BANNED)

        with self.assertRaises(HTTPException) as ctx:
            self._apply(["ban_home", "ban_home", "decider"], pool, item_id=102, action="ban")

        self.assertEqual(400, ctx.exception.status_code)
        self.assertEqual("Your side already banned an item with this attribute this round", ctx.exception.detail)

    def test_second_protect_of_the_same_role_is_still_rejected(self) -> None:
        pool = self._pool(first_status=MapPoolEntryStatus.PROTECTED)

        with self.assertRaises(HTTPException) as ctx:
            self._apply(["protect_home", "protect_home", "decider"], pool, item_id=102, action="protect")

        self.assertEqual(400, ctx.exception.status_code)
        self.assertEqual("Your side already protected an item with this attribute this round", ctx.exception.detail)

    def test_a_ban_is_not_barred_by_the_sides_own_earlier_protect_in_the_series(self) -> None:
        """``excluded_for_side`` is BAN memory: it never carried protects, so a
        protect cannot bar a later ban of the same item. The reverse (an actual
        earlier ban) still rejects."""
        pool = [make_entry(101, round=1), make_entry(102, round=1)]

        with self.assertRaises(HTTPException) as ctx:
            apply_pick_ban_action(
                SimpleNamespace(
                    resolved_sequence_json=["ban_home", "decider"],
                    status=MapVetoSessionStatus.ACTIVE.value,
                    current_step_started_at=None,
                ),
                pool,
                captain_side="home",
                item_id=101,
                action="ban",
                attribute_lookup={},
                unique_attribute=None,
                excluded_for_side=frozenset({101}),
                now=datetime.now(UTC),
            )

        self.assertEqual("Your side already banned this item earlier in the series", ctx.exception.detail)


class ProtectIsRoundLocalAcrossRoundsTests(TestCase):
    """A round's PROTECTED entry survives that round's close (only its untouched
    `available` leftovers are dropped), so a series pool holds the same item
    twice: the finished round's protected row and the new round's fresh
    candidate. The step must resolve against the round IN PLAY -- a protect on
    map 1 must not bar a ban of that hero on map 2."""

    def _series_pool(self) -> list:
        """Round 1 settled (101 protected by home, 102 banned by home), round 2
        freshly appended with 101 back as a candidate."""
        return [
            make_entry(
                101, status=MapPoolEntryStatus.PROTECTED, protected_by=MapPickSide.HOME, action_index=0, round=1
            ),
            make_entry(102, status=MapPoolEntryStatus.BANNED, picked_by=MapPickSide.HOME, action_index=1, round=1),
            make_entry(101, round=2),
            make_entry(103, round=2),
        ]

    def _ban(self, pool: list, *, item_id: int, side: str = "home"):
        return apply_pick_ban_action(
            SimpleNamespace(
                # Two rounds' worth of steps: round 1's are spent, round 2 opens.
                resolved_sequence_json=["protect_home", "ban_home", "ban_home", "ban_away"],
                status=MapVetoSessionStatus.ACTIVE.value,
                current_step_started_at=None,
            ),
            pool,
            captain_side=side,
            item_id=item_id,
            action="ban",
            attribute_lookup={},
            unique_attribute=None,
            now=datetime.now(UTC),
        )

    def test_the_side_that_protected_a_hero_may_ban_it_the_next_round(self) -> None:
        pool = self._series_pool()

        entry = self._ban(pool, item_id=101)

        self.assertEqual(2, entry.round)
        self.assertEqual(MapPoolEntryStatus.BANNED.value, entry.status)
        # The finished round's protected row is untouched -- it is history.
        self.assertEqual(MapPoolEntryStatus.PROTECTED.value, pool[0].status)

    def test_the_role_rule_ignores_a_finished_rounds_protect(self) -> None:
        """Role uniqueness is round-local, so round 1's tank protect must not
        spend round 2's tank budget for that side."""
        pool = self._series_pool()

        entry = apply_pick_ban_action(
            SimpleNamespace(
                resolved_sequence_json=["protect_home", "ban_home", "protect_home", "ban_away"],
                status=MapVetoSessionStatus.ACTIVE.value,
                current_step_started_at=None,
            ),
            pool,
            captain_side="home",
            item_id=101,
            action="protect",
            attribute_lookup={101: "tank", 102: "tank", 103: "support"},
            unique_attribute="role",
            now=datetime.now(UTC),
        )

        self.assertEqual(2, entry.round)
        self.assertEqual(MapPoolEntryStatus.PROTECTED.value, entry.status)


class SerializePickBanSessionSlotReservesTests(TestCase):
    """Pins the ``slot_reserves`` wire key -- the byte-identical-shape
    requirement for the map-veto cutover (Decision #12)."""

    def test_exposes_slot_reserves_json_under_the_legacy_key_name(self) -> None:
        pick_ban = SimpleNamespace(
            id=1,
            kind=PickBanKind.MAP,
            status=MapVetoSessionStatus.ACTIVE.value,
            first_side=MapPickSide.HOME.value,
            awaiting_choice=False,
            pending_loser_side=None,
            seed_source="fallback_home",
            home_seed=None,
            away_seed=None,
            turn_timer_seconds=45,
            slot_reserves_json={"2": 99},
            started_at=None,
            current_step_started_at=None,
        )

        wire = serialize_pick_ban_session(pick_ban)

        self.assertEqual({"2": 99}, wire["slot_reserves"])

    def test_hero_sessions_report_none_harmlessly(self) -> None:
        pick_ban = SimpleNamespace(
            id=1,
            kind=PickBanKind.HERO,
            status=MapVetoSessionStatus.ACTIVE.value,
            first_side=MapPickSide.HOME.value,
            awaiting_choice=False,
            pending_loser_side=None,
            seed_source="fallback_home",
            home_seed=None,
            away_seed=None,
            turn_timer_seconds=None,
            slot_reserves_json=None,
            started_at=None,
            current_step_started_at=None,
        )

        wire = serialize_pick_ban_session(pick_ban)

        self.assertIsNone(wire["slot_reserves"])
