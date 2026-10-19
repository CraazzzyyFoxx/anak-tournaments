"""The room as a LOOP: rounds opening off results, the healer, the clock and
the organizer's emergency controls.

The companion to ``test_pregame_participations.py``, which pins one round's
rules. What is pinned here is everything that moves a room WITHOUT a captain
doing anything: a confirmed position opening the next round's bans, a drawn one
not stalling it, the rotation counting rounds off the session's own opener, the
step timer expiring, and the four organizer commands.

Real Postgres, like its companion, and for the same reason: the rotation reads
confirmed games through the encounter's scoring rule, and a double would answer
whatever it was told to.
"""

from __future__ import annotations

import asyncio
import itertools
import json
import os
import sys
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import patch

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from shared.core import enums
from shared.core.errors import BaseAPIException
from shared.disciplines import DISCIPLINES, DisciplineSpec
from shared.domain import pick_ban_rules as pbr
from shared.models.encounter import Encounter, EncounterTeam, ScoringRule
from shared.models.encounter.game import EncounterGame, EncounterGameTeam
from shared.models.encounter.pick_ban import PickBanEntry, PickBanSession, PickBanSubmission
from shared.models.encounter.room_event import EncounterRoomEvent
from shared.models.identity.user import User
from shared.models.platform.audit import AuditLog
from shared.models.platform.outbox import EventOutbox
from shared.models.tenancy.workspace import Workspace
from shared.models.tournament.pick_ban import PickBanConfig, PickBanConfigItem
from shared.models.tournament.team import Team
from shared.models.tournament.tournament import Tournament
from shared.services.encounter.participants import place_team
from shared.testing import create_test_async_engine
from shared.testing.db import ensure_test_postgres
from src.rpc import _helpers as rpc_helpers
from src.rpc import pick_ban_admin
from src.services.encounter import room_control
from src.services.encounter.game_correction import game_correction_service
from src.services.encounter.games import GameResultIn, encounter_game_service
from src.services.encounter.map_report import ClaimResultIn, map_report_service
from src.services.encounter.pick_ban_action import pick_ban_action_service
from src.services.encounter.pick_ban_session import pick_ban_session_service, resolved_steps
from src.services.encounter.pick_ban_undo import pick_ban_undo_service
from src.services.encounter.veto_session import side_pick_pending, side_pick_required
from tests._rpc_fakes import CapturingBroker, make_identity
from tests.test_pregame_participations import FIRST_HERO, HEROES, SIDED

#: A second game with its own character classes: nothing about its pool is Overwatch's.
MOBA = DisciplineSpec(
    "moba", "Moba", (), kinds={"character": "Champion", "map": "Map"}, character_classes=("fighter", "mage")
)
CHAMPION_ID_BASE = 1_910_000_000
CHAMPIONS = {
    CHAMPION_ID_BASE + n: cls
    for n, cls in enumerate(("fighter", "mage", "fighter", "mage", "fighter", "fighter"), start=1)
}

_TAG = itertools.count()


def ban_ruleset(*, timer_seconds: int | None = None, with_side_pick: bool = False) -> dict:
    """One ban per participation each round, optionally behind a side pick that
    a LATER step then names (``side:attack``) -- the deferred-binding case."""
    steps: list[dict] = []
    if with_side_pick:
        steps.append(_step("sp", action="side_pick", actors="first"))
        steps.append(_step("b1", actors="side:attack"))
        steps.append(_step("b2", actors="side:defence"))
    else:
        steps.append(_step("b1", actors="first"))
        steps.append(_step("b2", actors="second"))
    return {
        "version": 2,
        "timer_seconds": timer_seconds,
        "on_timeout": "random_fill",
        "phases": [{"id": "main", "name": None, "when": {}, "pool_filter": {}, "generator": None, "steps": steps}],
    }


def _step(step_id: str, *, action: str = "ban", actors: str = "first") -> dict:
    return {
        "id": step_id,
        "action": action,
        "actors": actors,
        "count": 1,
        "min": None,
        "blind": False,
        "target": None,
        "lifetime": 1 if action == "ban" else None,
        "timer_seconds": None,
        "on_timeout": None,
        "dispute": {"enabled": False, "max": 0},
        "eligible": {},
        "constraints": [],
    }


class LoopCase(IsolatedAsyncioTestCase):
    """A two-seat, best-of-three encounter with a hero room per map."""

    if sys.platform == "win32":
        loop_factory = asyncio.SelectorEventLoop

    discipline = "overwatch"
    #: The game the hero pool's catalog rows belong to; the pool is ``{item_id: class}``.
    hero_discipline = "overwatch"
    rotation = enums.FirstBanRotation.FIXED

    def pool_rows(self) -> dict[int, str]:
        return {hero_id: role.name for hero_id, role in HEROES.items()}

    async def asyncSetUp(self) -> None:
        # The post-commit healer runs in its own session on a background task;
        # here every pass is driven explicitly through ``reconcile``.
        self._no_reconcile = patch("src.services.encounter.room_reconcile._stage", lambda *a, **k: None)
        self._no_reconcile.start()
        self.addCleanup(self._no_reconcile.stop)
        ensure_test_postgres()
        self.engine = create_test_async_engine()
        self.Session = async_sessionmaker(self.engine, expire_on_commit=False)
        self.tag = f"loop-{os.getpid()}-{next(_TAG)}"
        self.enterContext(patch.dict(DISCIPLINES, {SIDED.code: SIDED, MOBA.code: MOBA}))
        async with self.Session() as s:
            await s.execute(
                sa.text("INSERT INTO catalog.discipline (code, name) VALUES (:c, :n) ON CONFLICT DO NOTHING"),
                {"c": self.discipline, "n": self.discipline},
            )
            for hero_id, hero_class in self.pool_rows().items():
                await s.execute(
                    sa.text(
                        "INSERT INTO catalog.entity (id, discipline, kind, slug, name, attrs)"
                        " VALUES (:id, :discipline, 'character', :slug, :name, CAST(:attrs AS JSONB))"
                        " ON CONFLICT (id) DO NOTHING"
                    ),
                    {
                        "id": hero_id,
                        "discipline": self.hero_discipline,
                        "slug": f"h{hero_id}",
                        "name": f"H{hero_id}",
                        "attrs": json.dumps({"class": hero_class}),
                    },
                )
            workspace = Workspace(slug=self.tag, name=self.tag)
            s.add(workspace)
            await s.flush()
            self.workspace_id = workspace.id
            tournament = Tournament(
                workspace_id=workspace.id,
                discipline=self.discipline,
                name=self.tag,
                slug=self.tag,
                status=enums.TournamentStatus.LIVE,
            )
            s.add(tournament)
            await s.flush()
            self.tournament_id = tournament.id
            rule = ScoringRule(
                workspace_id=workspace.id,
                preset="wins",
                columns=[],
                game_formula="win",
                end_formula="games >= best_of",
            )
            s.add(rule)
            await s.flush()
            teams = [Team(tournament_id=tournament.id, name=f"T{i}", balancer_name=f"T{i}") for i in (1, 2)]
            s.add_all(teams)
            await s.flush()
            encounter = Encounter(
                workspace_id=workspace.id,
                discipline=self.discipline,
                tournament_id=tournament.id,
                scoring_rule_id=rule.id,
                name="E",
                slot_count=2,
                best_of=3,
                status=enums.EncounterStatus.OPEN,
            )
            s.add(encounter)
            await s.flush()
            self.encounter_id = encounter.id
            self.seats = []
            for slot, team in enumerate(teams, start=1):
                seat = await place_team(s, encounter, slot=slot, team_id=team.id, name=team.name, seed=slot, members=())
                self.seats.append(seat.id)
            await s.commit()
        self.slot1, self.slot2 = self.seats

    async def asyncTearDown(self) -> None:
        async with self.Session() as s:
            await s.execute(sa.delete(Workspace).where(Workspace.id == self.workspace_id))
            await s.commit()
        await self.engine.dispose()

    # -- helpers -----------------------------------------------------------
    async def save_config(self, ruleset: dict | None = None) -> None:
        """The organizer's saved hero config, nobody ready yet."""
        async with self.Session() as s:
            config = PickBanConfig(
                tournament_id=self.tournament_id,
                kind=enums.PickBanKind.HERO,
                mode=enums.MapVetoMode.POOL,
                first_ban_rotation=self.rotation,
                ruleset_json=ruleset or ban_ruleset(),
            )
            config.items = [
                PickBanConfigItem(item_id=item_id, sort_order=index) for index, item_id in enumerate(self.pool_rows())
            ]
            s.add(config)
            await s.commit()

    async def start(self, ruleset: dict | None = None) -> PickBanSession:
        await self.save_config(ruleset)
        async with self.Session() as s:
            encounter = await s.get_one(Encounter, self.encounter_id)
            for seat in self.seats:
                await pick_ban_session_service.mark_ready(s, encounter, seat, None)
            pick_ban = await pick_ban_session_service.ensure_pick_ban_session(s, encounter, enums.PickBanKind.HERO)
            assert pick_ban is not None
            return pick_ban

    async def reconcile(self) -> bool:
        """Drive the healer to convergence, exactly as the post-commit trigger
        and the one-second sweep do in production."""
        changed = False
        for _ in range(8):
            async with self.Session() as s:
                if not await pick_ban_action_service.reconcile_room(s, self.encounter_id, skip_locked=False):
                    return changed
            changed = True
        raise AssertionError("reconcile_room never converged")

    async def state(self, viewer: int | None = None) -> dict:
        async with self.Session() as s:
            return await pick_ban_action_service.get_pick_ban_state(
                s, self.encounter_id, enums.PickBanKind.HERO, viewer=viewer
            )

    async def act(self, actor: int, item_id: int, *, action: str = "ban") -> dict:
        async with self.Session() as s:
            return await pick_ban_action_service.perform_pick_ban_action(
                s, self.encounter_id, enums.PickBanKind.HERO, actor, item_id=item_id, action=action
            )

    async def play_round(self, items: tuple[int, int] = (FIRST_HERO, FIRST_HERO + 1)) -> None:
        """Both seats answer the round's two ban steps, in turn order."""
        for item_id in items:
            state = await self.state()
            (actor,) = state["acting_team_ids"]
            await self.act(actor, item_id)

    async def confirm_position(self, position: int, *, winner: int | None) -> None:
        """Confirm one position: ``winner=None`` records a DRAW."""
        async with self.Session() as s:
            encounter = await s.get_one(Encounter, self.encounter_id)
            game = next(
                (g for g in await encounter_game_service.list_games(s, self.encounter_id) if g.position == position),
                None,
            )
            if game is None:
                game = await encounter_game_service.open_game(s, encounter, position=position)
            await encounter_game_service.record_result(
                s,
                encounter,
                game,
                results=[
                    GameResultIn(encounter_team_id=seat, score=1 if (winner is None or seat == winner) else 0)
                    for seat in self.seats
                ],
                source=enums.EncounterGameResultSource.ADMIN,
                actor_user_id=None,
            )
            await s.commit()

    async def openers(self) -> list[int]:
        """Who opened each round, off the journal the append writes."""
        async with self.Session() as s:
            rows = (
                (
                    await s.execute(
                        sa.select(EncounterRoomEvent.data)
                        .where(
                            EncounterRoomEvent.encounter_id == self.encounter_id,
                            EncounterRoomEvent.action.in_(("session_opened", "round_opened")),
                        )
                        .order_by(EncounterRoomEvent.id)
                    )
                )
                .scalars()
                .all()
            )
        return [row["first_team_id"] for row in rows]


# ── results open the next round ─────────────────────────────────────────────


class RoundsFollowTheSeriesTests(LoopCase):
    async def test_a_confirmed_position_opens_the_next_round(self) -> None:
        """The coupling Task 6 dropped: nothing but a confirmed result opens
        round 2, and nothing but the reconciler applies it."""
        await self.start()
        await self.play_round()
        # Round 1 is spent, and round 2 is NOT owed until a position lands.
        # (The healer still opens the series' next freeplay position -- that is
        # a different owed thing, and `round_owed` is the one being pinned.)
        await self.reconcile()
        async with self.Session() as s:
            encounter = await s.get_one(Encounter, self.encounter_id)
            self.assertFalse(await pick_ban_session_service.round_owed(s, encounter, enums.PickBanKind.HERO))
        async with self.Session() as s:
            pick_ban = await pick_ban_session_service.get_pick_ban_session(s, self.encounter_id, enums.PickBanKind.HERO)
        self.assertEqual(1, max(row["round"] for row in pick_ban.resolved_sequence_json))

        await self.confirm_position(1, winner=self.slot1)
        self.assertTrue(await self.reconcile())
        state = await self.state()
        self.assertEqual(2, state["current_round"])

    async def test_a_drawn_position_does_not_stall_the_rotation(self) -> None:
        """A draw is DECIDED and names nobody, so the rotation falls back to the
        session's opener and round 2 opens. Conflating it with 'pending' left
        the room on an exhausted sequence forever."""
        self.rotation = enums.FirstBanRotation.RESULT_WINNER_FIRST
        await self.start()
        await self.play_round()
        await self.confirm_position(1, winner=None)

        async with self.Session() as s:
            encounter = await s.get_one(Encounter, self.encounter_id)
            decided, winner = await pick_ban_session_service.round_result(s, encounter, 1)
        self.assertEqual((True, None), (decided, winner))

        self.assertTrue(await self.reconcile())
        self.assertEqual(2, (await self.state())["current_round"])
        self.assertEqual([self.slot1, self.slot1], await self.openers())

    async def test_a_pending_position_still_owes_the_round(self) -> None:
        self.rotation = enums.FirstBanRotation.RESULT_WINNER_FIRST
        await self.start()
        await self.play_round()
        async with self.Session() as s:
            encounter = await s.get_one(Encounter, self.encounter_id)
            self.assertEqual((False, None), await pick_ban_session_service.round_result(s, encounter, 1))
            self.assertFalse(await pick_ban_session_service.round_owed(s, encounter, enums.PickBanKind.HERO))
        await self.reconcile()
        async with self.Session() as s:
            pick_ban = await pick_ban_session_service.get_pick_ban_session(s, self.encounter_id, enums.PickBanKind.HERO)
        self.assertEqual(1, max(row["round"] for row in pick_ban.resolved_sequence_json))

    async def test_the_winner_opens_the_next_round_under_result_winner_first(self) -> None:
        self.rotation = enums.FirstBanRotation.RESULT_WINNER_FIRST
        await self.start()
        await self.play_round()
        await self.confirm_position(1, winner=self.slot2)
        await self.reconcile()
        self.assertEqual([self.slot1, self.slot2], await self.openers())


class AlternateRotationTests(LoopCase):
    rotation = enums.FirstBanRotation.ALTERNATE

    async def test_alternate_counts_rounds_off_the_session_opener(self) -> None:
        """Three rounds, through the service. Writing each round's opener back
        onto the session made round 3 repeat round 2 instead of coming back to
        the seed opener."""
        await self.start()
        for position in (1, 2):
            await self.play_round()
            await self.confirm_position(position, winner=None)
            await self.reconcile()
        await self.play_round()

        self.assertEqual([self.slot1, self.slot2, self.slot1], await self.openers())
        async with self.Session() as s:
            pick_ban = await pick_ban_session_service.get_pick_ban_session(s, self.encounter_id, enums.PickBanKind.HERO)
        self.assertEqual(self.slot1, pick_ban.first_team_id)


# ── the clock ───────────────────────────────────────────────────────────────


class ExpiryTests(LoopCase):
    async def test_an_expired_step_is_random_filled_and_journalled(self) -> None:
        await self.start(ban_ruleset(timer_seconds=30))
        async with self.Session() as s:
            pick_ban = await pick_ban_session_service.get_pick_ban_session(
                s, self.encounter_id, enums.PickBanKind.HERO, for_update=True
            )
            pick_ban.current_step_started_at = datetime.now(UTC) - timedelta(minutes=5)
            await s.commit()

        self.assertTrue(await self.reconcile())
        state = await self.state()
        banned = [entry for entry in state["pool"] if entry["status"] == "banned"]
        self.assertEqual(1, len(banned))
        self.assertEqual(self.slot1, banned[0]["picked_by_team_id"])
        async with self.Session() as s:
            rows = (
                (
                    await s.execute(
                        sa.select(EncounterRoomEvent.data).where(
                            EncounterRoomEvent.encounter_id == self.encounter_id,
                            EncounterRoomEvent.action == "step_timed_out",
                        )
                    )
                )
                .scalars()
                .all()
            )
        self.assertEqual([[self.slot1]], [row["team_ids"] for row in rows])

    async def test_a_paused_room_has_no_clock_to_run_out(self) -> None:
        await self.start(ban_ruleset(timer_seconds=30))
        async with self.Session() as s:
            await room_control.set_paused(
                s, self.encounter_id, enums.PickBanKind.HERO, paused=True, actor_auth_user_id=None
            )
        async with self.Session() as s:
            pick_ban = await pick_ban_session_service.get_pick_ban_session(
                s, self.encounter_id, enums.PickBanKind.HERO, for_update=True
            )
            pick_ban.current_step_started_at = datetime.now(UTC) - timedelta(minutes=5)
            await s.commit()

        await self.reconcile()
        state = await self.state()
        self.assertIsNone(state["step_deadline"])
        self.assertEqual([], [entry for entry in state["pool"] if entry["status"] == "banned"])


# ── the organizer's controls ────────────────────────────────────────────────


class RoomControlTests(LoopCase):
    async def test_pause_refuses_captain_writes_and_resume_gives_the_time_back(self) -> None:
        await self.start(ban_ruleset(timer_seconds=60))
        async with self.Session() as s:
            await room_control.set_paused(
                s, self.encounter_id, enums.PickBanKind.HERO, paused=True, actor_auth_user_id=None
            )
        async with self.Session() as s:
            with self.assertRaises(BaseAPIException) as refused:
                await pick_ban_action_service.perform_pick_ban_action(
                    s, self.encounter_id, enums.PickBanKind.HERO, self.slot1, item_id=FIRST_HERO, action="ban"
                )
            self.assertEqual(409, refused.exception.status_code)

        async with self.Session() as s:
            pick_ban = await pick_ban_session_service.get_pick_ban_session(s, self.encounter_id, enums.PickBanKind.HERO)
            before = pick_ban.current_step_started_at
        async with self.Session() as s:
            await room_control.set_paused(
                s, self.encounter_id, enums.PickBanKind.HERO, paused=False, actor_auth_user_id=None
            )
        async with self.Session() as s:
            pick_ban = await pick_ban_session_service.get_pick_ban_session(s, self.encounter_id, enums.PickBanKind.HERO)
        self.assertIsNone(pick_ban.paused_at)
        # The step keeps the time it had left: its start moved forward by the pause.
        self.assertGreaterEqual(pick_ban.current_step_started_at, before)
        await self.act(self.slot1, FIRST_HERO)

    async def test_extend_moves_the_deadline_and_journals_the_step(self) -> None:
        await self.start(ban_ruleset(timer_seconds=60))
        first = (await self.state())["step_deadline"]
        async with self.Session() as s:
            await room_control.extend_step_timer(
                s, self.encounter_id, enums.PickBanKind.HERO, seconds=120, actor_auth_user_id=None
            )
        self.assertGreater((await self.state())["step_deadline"], first)
        async with self.Session() as s:
            rows = (
                (
                    await s.execute(
                        sa.select(EncounterRoomEvent.data).where(
                            EncounterRoomEvent.encounter_id == self.encounter_id,
                            EncounterRoomEvent.action == "timer_extended",
                        )
                    )
                )
                .scalars()
                .all()
            )
        self.assertEqual([{"seconds": 120, "step_index": 0}], rows)

    async def test_extend_refuses_a_room_with_no_timed_step(self) -> None:
        await self.start()
        async with self.Session() as s:
            with self.assertRaises(BaseAPIException) as refused:
                await room_control.extend_step_timer(
                    s, self.encounter_id, enums.PickBanKind.HERO, seconds=60, actor_auth_user_id=None
                )
        self.assertEqual(409, refused.exception.status_code)

    async def test_cancel_retires_the_session_and_refuses_a_second_cancel(self) -> None:
        await self.start()
        async with self.Session() as s:
            state = await room_control.cancel_session(
                s, self.encounter_id, enums.PickBanKind.HERO, reason="opponent never showed", actor_auth_user_id=None
            )
        self.assertEqual(enums.MapVetoSessionStatus.CANCELLED, state["session"]["status"])
        async with self.Session() as s:
            with self.assertRaises(BaseAPIException) as refused:
                await room_control.cancel_session(
                    s, self.encounter_id, enums.PickBanKind.HERO, reason="again", actor_auth_user_id=None
                )
            self.assertEqual(409, refused.exception.status_code)
        # A cancelled room settles nothing further, and the reason is on record.
        await self.reconcile()
        async with self.Session() as s:
            pick_ban = await pick_ban_session_service.get_pick_ban_session(s, self.encounter_id, enums.PickBanKind.HERO)
            self.assertEqual(enums.MapVetoSessionStatus.CANCELLED, pick_ban.status)
        async with self.Session() as s:
            reason = await s.scalar(
                sa.select(EncounterRoomEvent.reason).where(
                    EncounterRoomEvent.encounter_id == self.encounter_id,
                    EncounterRoomEvent.action == "session_cancelled",
                )
            )
        self.assertEqual("opponent never showed", reason)

    async def test_a_technical_loss_cancels_the_room_and_confirms_the_series(self) -> None:
        await self.start()
        async with self.Session() as s:
            encounter = await s.get_one(Encounter, self.encounter_id)
            encounter = await room_control.technical_loss(
                s,
                encounter,
                loser_team_id=self.slot2,
                results=None,
                reason="walkover",
                actor_auth_user_id=None,
                actor_player_id=None,
            )
        self.assertEqual(enums.EncounterResultStatus.CONFIRMED, encounter.result_status)
        async with self.Session() as s:
            pick_ban = await pick_ban_session_service.get_pick_ban_session(s, self.encounter_id, enums.PickBanKind.HERO)
            scores = {
                seat.id: seat.score
                for seat in (
                    await s.execute(sa.select(EncounterTeam).where(EncounterTeam.encounter_id == self.encounter_id))
                ).scalars()
            }
        self.assertEqual(enums.MapVetoSessionStatus.CANCELLED, pick_ban.status)
        self.assertEqual({self.slot1: 2.0, self.slot2: 0.0}, scores)

    async def test_a_technical_loss_refuses_a_seat_that_does_not_play_here(self) -> None:
        await self.start()
        async with self.Session() as s:
            encounter = await s.get_one(Encounter, self.encounter_id)
            with self.assertRaises(BaseAPIException) as refused:
                await room_control.technical_loss(
                    s,
                    encounter,
                    loser_team_id=-1,
                    results=None,
                    reason="walkover",
                    actor_auth_user_id=None,
                    actor_player_id=None,
                )
            self.assertEqual(422, refused.exception.status_code)


# ── item groups are read in the encounter's own game ────────────────────────


class ScopedItemGroupTests(LoopCase):
    """An ``item_group`` rule over ANOTHER game's classes, through the whole live path.

    Constructor preview/save alone proves nothing about eligibility: the room hydrates groups on its own at session
    creation, on every action reload and when the next round materializes. Each of those once read Overwatch's catalog,
    so a champion pool had no group at all and every ``item_group`` filter excluded it."""

    discipline = MOBA.code
    hero_discipline = MOBA.code

    def pool_rows(self) -> dict[int, str]:
        return dict(CHAMPIONS)

    @staticmethod
    def fighter_only() -> dict:
        document = ban_ruleset()
        document["phases"][0]["pool_filter"] = {"type": "item_group", "params": {"groups": ["fighter"]}}
        return document

    async def round_items(self) -> dict[int, set[int]]:
        """Candidate items of each round as entries, carried bans aside."""
        async with self.Session() as s:
            pick_ban = await pick_ban_session_service.get_pick_ban_session(s, self.encounter_id, enums.PickBanKind.HERO)
            rows = (
                await s.execute(
                    sa.select(PickBanEntry.round, PickBanEntry.item_id).where(
                        PickBanEntry.session_id == pick_ban.id, PickBanEntry.carried_from_round.is_(None)
                    )
                )
            ).all()
        items: dict[int, set[int]] = {}
        for round_number, item_id in rows:
            items.setdefault(round_number, set()).add(item_id)
        return items

    async def test_the_class_filter_holds_at_creation_on_reload_and_in_the_next_round(self) -> None:
        fighters = {item_id for item_id, cls in CHAMPIONS.items() if cls == "fighter"}
        mage = next(item_id for item_id, cls in CHAMPIONS.items() if cls == "mage")

        await self.start(self.fighter_only())
        # Session creation (``_ensure_pick_ban_session``): only fighters became entries.
        self.assertEqual(fighters, (await self.round_items())[1])

        # Action reload (``pick_ban_action._load``): a fighter is bannable, a mage is not in the room.
        (actor,) = (await self.state())["acting_team_ids"]
        with self.assertRaises(BaseAPIException):
            await self.act(actor, mage)
        await self.play_round(tuple(sorted(fighters))[:2])

        # Next-round materialization (``advance_to_next_round``).
        await self.confirm_position(1, winner=self.slot1)
        self.assertTrue(await self.reconcile())
        self.assertEqual(2, (await self.state())["current_round"])
        self.assertEqual(fighters, (await self.round_items())[2])

    async def test_a_step_level_item_group_condition_decides_eligibility_after_reload(self) -> None:
        """The same class vocabulary as a per-STEP eligibility condition (not a pool filter): every champion stays in
        the room, but only fighters are eligible, and the action path judges a mage by the same rule."""
        fighters = {item_id for item_id, cls in CHAMPIONS.items() if cls == "fighter"}
        mage = next(item_id for item_id, cls in CHAMPIONS.items() if cls == "mage")
        document = ban_ruleset()
        for step in document["phases"][0]["steps"]:
            step["eligible"] = {"type": "item_group", "params": {"groups": ["fighter"]}}

        await self.start(document)
        self.assertEqual(set(CHAMPIONS), (await self.round_items())[1])

        # A fresh read (``pick_ban_action._load``) as the acting captain: the eligible set is the fighters.
        (actor,) = (await self.state())["acting_team_ids"]
        state = await self.state(viewer=actor)
        self.assertEqual(fighters, set(state["eligible"]["item_ids"]))
        self.assertEqual(["ban"], state["allowed_actions"])

        with self.assertRaises(BaseAPIException):
            await self.act(actor, mage)
        await self.act(actor, min(fighters))
        banned = {entry["item_id"] for entry in (await self.state())["pool"] if entry["status"] == "banned"}
        self.assertEqual({min(fighters)}, banned)


# ── side actors bind after the pick ─────────────────────────────────────────


class DeferredSideActorTests(LoopCase):
    discipline = SIDED.code

    async def test_a_side_actor_binds_once_the_side_pick_is_played(self) -> None:
        """A round's steps resolve when the round OPENS, but ``side:attack``
        names whoever the side pick hands attack to -- which is not known
        then. The step is written unbound, the cursor stops on it, and the
        binding lands the moment the pick reveals."""
        await self.start(ban_ruleset(with_side_pick=True))

        async with self.Session() as s:
            pick_ban = await pick_ban_session_service.get_pick_ban_session(s, self.encounter_id, enums.PickBanKind.HERO)
            teams = await pick_ban_session_service.teams_of(s, self.encounter_id)
            steps = resolved_steps(pick_ban, teams)
        self.assertEqual(["side:attack", "side:defence"], [step.actors_token for step in steps[1:]])
        self.assertEqual([[], []], [step.actors for step in steps[1:]])

        state = await self.state()
        self.assertEqual("side_pick", state["expected_action"])
        self.assertEqual([self.slot1], state["acting_team_ids"])

        # Slot 1 takes "defence" (index 1), so slot 2 gets "attack".
        await self.act(self.slot1, 1, action="side_pick")

        async with self.Session() as s:
            pick_ban = await pick_ban_session_service.get_pick_ban_session(s, self.encounter_id, enums.PickBanKind.HERO)
            teams = await pick_ban_session_service.teams_of(s, self.encounter_id)
            steps = resolved_steps(pick_ban, teams)
            rows = (
                (
                    await s.execute(
                        sa.select(EncounterGameTeam).where(EncounterGameTeam.encounter_id == self.encounter_id)
                    )
                )
                .scalars()
                .all()
            )
        # The token STAYS after the binding -- an undo of the pick has to be
        # able to take the actors back.
        self.assertEqual(["side:attack", "side:defence"], [step.actors_token for step in steps[1:]])
        self.assertEqual([[self.slot2], [self.slot1]], [step.actors for step in steps[1:]])
        self.assertEqual(
            {self.slot1: "defence", self.slot2: "attack"},
            {row.encounter_team_id: row.starting_side for row in rows},
        )

        # And the room now takes the bound step from the right seat.
        self.assertEqual([self.slot2], (await self.state())["acting_team_ids"])

    async def test_a_game_cannot_start_while_its_side_pick_is_open(self) -> None:
        """Spec §6 row 9. The position may be NAMED, but no map selection, no
        claim and no accepted result may land on it until the side is decided --
        labelling the row ``planned`` is not a refusal, so the three write paths
        ask the room themselves."""
        await self.start(ban_ruleset(with_side_pick=True))
        # Freeplay owns the positions here (the hero room names no maps), so
        # the healer opens position 1 for real.
        await self.reconcile()
        async with self.Session() as s:
            games = await encounter_game_service.list_games(s, self.encounter_id)
        self.assertEqual([1], [game.position for game in games])
        game_id = games[0].id

        async with self.Session() as s:
            self.assertTrue(await side_pick_pending(s, self.encounter_id, 1))
            with self.assertRaises(BaseAPIException) as refused:
                await map_report_service.submit_game_claim(
                    s,
                    game_id,
                    claimant_team_id=self.slot1,
                    reporter_user_id=None,
                    results=[ClaimResultIn(encounter_team_id=seat, score=1) for seat in self.seats],
                    basis_version=0,
                )
            self.assertEqual(409, refused.exception.status_code)
            self.assertEqual("side_pick_pending", refused.exception.detail[0].code)

        async with self.Session() as s:
            encounter = await s.get_one(Encounter, self.encounter_id)
            game = await s.get_one(EncounterGame, game_id)
            with self.assertRaises(BaseAPIException) as locked:
                await encounter_game_service.select_map(s, encounter, game, map_id=1)
            self.assertEqual(409, locked.exception.status_code)
            with self.assertRaises(BaseAPIException) as result:
                await encounter_game_service.record_result(
                    s,
                    encounter,
                    game,
                    results=[GameResultIn(encounter_team_id=seat, score=1) for seat in self.seats],
                    source=enums.EncounterGameResultSource.ADMIN,
                    actor_user_id=None,
                )
            self.assertEqual(409, result.exception.status_code)

        # Once the side is picked the same claim is accepted.
        await self.act(self.slot1, 0, action="side_pick")
        async with self.Session() as s:
            self.assertFalse(await side_pick_pending(s, self.encounter_id, 1))
            answer = await map_report_service.submit_game_claim(
                s,
                game_id,
                claimant_team_id=self.slot1,
                reporter_user_id=None,
                results=[
                    ClaimResultIn(encounter_team_id=seat, score=1 if seat == self.slot1 else 0) for seat in self.seats
                ],
                basis_version=0,
            )
        self.assertFalse(answer["disputed"])

    async def test_undoing_a_side_pick_takes_its_bindings_back(self) -> None:
        """A later ``side:<code>`` step was bound to whoever the pick handed
        that side to; the undo has to take the binding with it, or a re-pick
        would leave those steps acting for the OLD assignment."""
        await self.start(ban_ruleset(with_side_pick=True))
        await self.act(self.slot1, 1, action="side_pick")  # slot 1 takes defence
        self.assertEqual([self.slot2], (await self.state())["acting_team_ids"])

        for seat in self.seats:
            async with self.Session() as s:
                await pick_ban_undo_service.perform_undo(s, self.encounter_id, enums.PickBanKind.HERO, seat)

        async with self.Session() as s:
            pick_ban = await pick_ban_session_service.get_pick_ban_session(s, self.encounter_id, enums.PickBanKind.HERO)
            teams = await pick_ban_session_service.teams_of(s, self.encounter_id)
            steps = resolved_steps(pick_ban, teams)
        self.assertEqual([[], []], [step.actors for step in steps[1:]])
        self.assertTrue(all(step.is_unbound for step in steps[1:]))
        # The room is back on the side pick, and the OTHER choice binds the
        # later steps the other way round.
        self.assertEqual([self.slot1], (await self.state())["acting_team_ids"])
        await self.act(self.slot1, 0, action="side_pick")  # this time: attack
        self.assertEqual([self.slot1], (await self.state())["acting_team_ids"])

    async def test_a_side_pick_nobody_answered_is_settled_by_a_coin_flip(self) -> None:
        """The rules' own default on timeout. ``random_fill`` has no items to
        draw on for a side, so the clock flips a coin between the discipline's
        sides and the room moves on."""
        await self.start(ban_ruleset(timer_seconds=30, with_side_pick=True))
        async with self.Session() as s:
            pick_ban = await pick_ban_session_service.get_pick_ban_session(
                s, self.encounter_id, enums.PickBanKind.HERO, for_update=True
            )
            pick_ban.current_step_started_at = datetime.now(UTC) - timedelta(minutes=5)
            await s.commit()

        self.assertTrue(await self.reconcile())
        async with self.Session() as s:
            rows = (
                (
                    await s.execute(
                        sa.select(EncounterGameTeam).where(EncounterGameTeam.encounter_id == self.encounter_id)
                    )
                )
                .scalars()
                .all()
            )
            self.assertFalse(await side_pick_pending(s, self.encounter_id, 1))
        self.assertEqual({"attack", "defence"}, {row.starting_side for row in rows})
        # And the step the flip settled bound the one that names its side.
        self.assertEqual(1, len((await self.state())["acting_team_ids"]))


# ── positions: the helpers the side and correction cases share ──────────────


def _map_index(op: str, value: int) -> dict:
    return {"type": "map_index", "params": {"op": op, "value": value}}


def phased_ruleset() -> dict:
    """Map 1 plays a side pick before its bans; map 2 on bans only."""
    first = {**ban_ruleset(with_side_pick=True)["phases"][0], "id": "first", "when": _map_index("==", 1)}
    later = {**ban_ruleset()["phases"][0], "id": "later", "when": _map_index(">=", 2)}
    return {**ban_ruleset(), "phases": [first, later]}


def _code(exc: BaseAPIException) -> str:
    return exc.detail[0].code


class PositionCase(LoopCase):
    async def game_id(self, position: int) -> int:
        async with self.Session() as s:
            games = await encounter_game_service.list_games(s, self.encounter_id)
        return next(game.id for game in games if game.position == position)

    async def open_position(self, position: int) -> int:
        async with self.Session() as s:
            encounter = await s.get_one(Encounter, self.encounter_id)
            game = await encounter_game_service.open_game(s, encounter, position=position)
            await s.commit()
            return game.id

    def lines(self, winner: int, score: int = 3) -> list[GameResultIn]:
        return [GameResultIn(encounter_team_id=seat, score=score if seat == winner else 1) for seat in self.seats]

    async def record(self, game_id: int, *, winner: int) -> None:
        async with self.Session() as s:
            encounter = await s.get_one(Encounter, self.encounter_id)
            game = await s.get_one(EncounterGame, game_id)
            await encounter_game_service.record_result(
                s,
                encounter,
                game,
                results=self.lines(winner),
                source=enums.EncounterGameResultSource.ADMIN,
                actor_user_id=None,
            )
            await s.commit()

    async def claim(self, game_id: int, *, claimant: int, winner: int) -> dict:
        async with self.Session() as s:
            return await map_report_service.submit_game_claim(
                s,
                game_id,
                claimant_team_id=claimant,
                reporter_user_id=None,
                results=[
                    ClaimResultIn(encounter_team_id=seat, score=3 if seat == winner else 1) for seat in self.seats
                ],
                basis_version=0,
            )

    async def select_map(self, game_id: int) -> None:
        async with self.Session() as s:
            encounter = await s.get_one(Encounter, self.encounter_id)
            game = await s.get_one(EncounterGame, game_id)
            await encounter_game_service.select_map(s, encounter, game, map_id=1)
            await s.commit()

    async def refused(self, call) -> str:
        """The 409 ``call`` answers with, by code."""
        with self.assertRaises(BaseAPIException) as caught:
            await call
        self.assertEqual(409, caught.exception.status_code)
        return _code(caught.exception)

    async def sides(self, game_id: int) -> dict[int, str | None]:
        async with self.Session() as s:
            rows = (
                (await s.execute(sa.select(EncounterGameTeam).where(EncounterGameTeam.game_id == game_id)))
                .scalars()
                .all()
            )
        return {row.encounter_team_id: row.starting_side for row in rows}

    async def game_row(self, game_id: int) -> tuple:
        async with self.Session() as s:
            game = await s.get_one(EncounterGame, game_id)
            claims = (await encounter_game_service.claims_by_game(s, [game]))[game.id]
            return game.state, game.map_id, game.result_version, len(claims)

    async def required(self, position: int) -> bool:
        async with self.Session() as s:
            encounter = await s.get_one(Encounter, self.encounter_id)
            return await side_pick_required(s, encounter, position)

    async def undo(self, seat: int) -> dict:
        async with self.Session() as s:
            return await pick_ban_undo_service.perform_undo(s, self.encounter_id, enums.PickBanKind.HERO, seat)

    async def admin_reopen(self) -> dict:
        async with self.Session() as s:
            return await pick_ban_action_service.admin_reopen_step(s, self.encounter_id, enums.PickBanKind.HERO)

    async def reset(self, kind: enums.PickBanKind) -> None:
        async with self.Session() as s:
            encounter = await s.get_one(Encounter, self.encounter_id)
            await pick_ban_session_service.reset_pick_ban_session(s, encounter, kind)

    async def hero_session(self) -> PickBanSession:
        async with self.Session() as s:
            return await pick_ban_session_service.get_pick_ban_session(s, self.encounter_id, enums.PickBanKind.HERO)

    async def steps(self) -> list[pbr.ResolvedStep]:
        async with self.Session() as s:
            pick_ban = await pick_ban_session_service.get_pick_ban_session(s, self.encounter_id, enums.PickBanKind.HERO)
            return resolved_steps(pick_ban, await pick_ban_session_service.teams_of(s, self.encounter_id))

    async def submissions(self) -> list[tuple]:
        async with self.Session() as s:
            rows = await s.execute(
                sa.select(
                    PickBanSubmission.id,
                    PickBanSubmission.step_index,
                    PickBanSubmission.encounter_team_id,
                    PickBanSubmission.state,
                    PickBanSubmission.items_json,
                )
                .where(PickBanSubmission.encounter_id == self.encounter_id)
                .order_by(PickBanSubmission.id)
            )
            return [tuple(row) for row in rows]

    async def events(self) -> int:
        async with self.Session() as s:
            return await s.scalar(
                sa.select(sa.func.count())
                .select_from(EncounterRoomEvent)
                .where(EncounterRoomEvent.encounter_id == self.encounter_id)
            )


# ── sides are required where the room picks them, and only there ────────────


class SideRequiredTests(PositionCase):
    discipline = SIDED.code

    async def test_a_saved_side_config_refuses_a_game_before_its_room_opens(self) -> None:
        """Captains not ready yet: no session, but the saved config picks this
        game's sides, so the game cannot start around the room."""
        await self.save_config(ban_ruleset(with_side_pick=True))
        game_id = await self.open_position(1)
        before = await self.game_row(game_id)
        self.assertTrue(await self.required(1))
        self.assertEqual("side_pick_required", await self.refused(self.select_map(game_id)))
        self.assertEqual(
            "side_pick_required", await self.refused(self.claim(game_id, claimant=self.slot1, winner=self.slot1))
        )
        self.assertEqual("side_pick_required", await self.refused(self.record(game_id, winner=self.slot1)))
        self.assertEqual(before, await self.game_row(game_id))

        # The room opens: its side step is PENDING first, and the pick settles it.
        async with self.Session() as s:
            encounter = await s.get_one(Encounter, self.encounter_id)
            for seat in self.seats:
                await pick_ban_session_service.mark_ready(s, encounter, seat, None)
            await pick_ban_session_service.ensure_pick_ban_session(s, encounter, enums.PickBanKind.HERO)
        self.assertEqual("side_pick_pending", await self.refused(self.record(game_id, winner=self.slot1)))
        await self.act(self.slot1, 0, action="side_pick")
        await self.record(game_id, winner=self.slot1)
        self.assertEqual(enums.EncounterGameState.CONFIRMED, (await self.game_row(game_id))[0])

    async def test_a_game_no_room_picks_sides_for_records_like_a_side_less_one(self) -> None:
        first = await self.open_position(1)
        self.assertFalse(await self.required(1))
        await self.record(first, winner=self.slot1)

        # A custom ruleset that never picks a side is the same answer.
        await self.save_config(ban_ruleset())
        second = await self.open_position(2)
        self.assertEqual((False, False), (await self.required(1), await self.required(2)))
        await self.record(second, winner=self.slot2)

    async def test_a_cancelled_room_owes_no_side(self) -> None:
        await self.start(ban_ruleset(with_side_pick=True))
        async with self.Session() as s:
            self.assertTrue(await side_pick_pending(s, self.encounter_id, 1))
        async with self.Session() as s:
            await room_control.cancel_session(
                s, self.encounter_id, enums.PickBanKind.HERO, reason="played elsewhere", actor_auth_user_id=None
            )
        async with self.Session() as s:
            self.assertFalse(await side_pick_pending(s, self.encounter_id, 1))
        self.assertFalse(await self.required(1))
        await self.record(await self.open_position(1), winner=self.slot1)

    async def test_a_side_row_left_empty_is_still_required(self) -> None:
        await self.start(ban_ruleset(with_side_pick=True))
        await self.act(self.slot1, 0, action="side_pick")
        game_id = await self.game_id(1)
        async with self.Session() as s:
            row = (
                await s.execute(
                    sa.select(EncounterGameTeam).where(
                        EncounterGameTeam.game_id == game_id, EncounterGameTeam.encounter_team_id == self.slot2
                    )
                )
            ).scalar_one()
            row.starting_side = None
            await s.commit()
        self.assertEqual("side_pick_required", await self.refused(self.record(game_id, winner=self.slot1)))

    async def test_a_phased_config_requires_sides_only_for_the_game_its_phase_picks_them_for(self) -> None:
        await self.save_config(phased_ruleset())
        first, second = await self.open_position(1), await self.open_position(2)
        self.assertEqual((True, False), (await self.required(1), await self.required(2)))
        self.assertEqual("side_pick_required", await self.refused(self.record(first, winner=self.slot1)))
        await self.record(second, winner=self.slot2)

    async def test_a_phased_room_takes_the_second_games_result_without_sides(self) -> None:
        await self.start(phased_ruleset())
        await self.act(self.slot1, 0, action="side_pick")
        await self.play_round()
        await self.confirm_position(1, winner=self.slot1)
        await self.reconcile()
        state = await self.state()
        self.assertEqual((2, "ban"), (state["current_round"], state["expected_action"]))
        self.assertEqual((True, False), (await self.required(1), await self.required(2)))
        second = await self.game_id(2)
        self.assertFalse((await self.claim(second, claimant=self.slot1, winner=self.slot2))["disputed"])
        await self.record(second, winner=self.slot2)


class StartingSidesTests(PositionCase):
    discipline = SIDED.code

    async def test_a_hero_room_reports_each_games_sides_with_its_position(self) -> None:
        await self.start(ban_ruleset(with_side_pick=True))
        self.assertEqual([], (await self.state())["starting_sides"])
        await self.act(self.slot1, 1, action="side_pick")
        self.assertEqual(
            [
                {
                    "game_id": await self.game_id(1),
                    "position": 1,
                    "sides": {str(self.slot1): "defence", str(self.slot2): "attack"},
                }
            ],
            (await self.state())["starting_sides"],
        )


class SideLessStateTests(PositionCase):
    async def test_an_overwatch_hero_room_reports_no_sides(self) -> None:
        await self.start()
        state = await self.state()
        self.assertEqual(([], []), (state["sides"], state["starting_sides"]))

    async def test_reopening_a_ban_keeps_its_draft(self) -> None:
        await self.start()
        await self.act(self.slot1, FIRST_HERO)
        await self.admin_reopen()
        drafts = [(team, items) for _id, _index, team, state, items in await self.submissions() if state == pbr.DRAFT]
        self.assertEqual([(self.slot1, [{"item_id": FIRST_HERO, "target_player_id": None}])], drafts)


# ── a played side is never rewound ──────────────────────────────────────────


class SideRewindTests(PositionCase):
    discipline = SIDED.code

    async def frozen(self, game_id: int) -> tuple:
        return await self.sides(game_id), await self.submissions(), await self.events()

    async def test_undoing_an_unplayed_side_pick_takes_both_sides_back(self) -> None:
        await self.start(ban_ruleset(with_side_pick=True))
        await self.act(self.slot1, 1, action="side_pick")
        game_id = await self.game_id(1)
        self.assertEqual({self.slot1: "defence", self.slot2: "attack"}, await self.sides(game_id))
        for seat in self.seats:
            await self.undo(seat)
        self.assertEqual({self.slot1: None, self.slot2: None}, await self.sides(game_id))
        self.assertEqual([], (await self.state())["starting_sides"])
        self.assertTrue(all(step.is_unbound for step in (await self.steps())[1:]))

    async def test_a_side_somebody_played_on_cannot_be_undone(self) -> None:
        await self.start(ban_ruleset(with_side_pick=True))
        await self.act(self.slot1, 0, action="side_pick")
        game_id = await self.game_id(1)
        await self.undo(self.slot1)  # asked while nobody had played: fine

        async def assert_locked() -> None:
            frozen = await self.frozen(game_id)
            # The consent that would apply it, and a fresh request.
            self.assertEqual("side_locked", await self.refused(self.undo(self.slot2)))
            self.assertEqual("side_locked", await self.refused(self.undo(self.slot1)))
            self.assertEqual(frozen, await self.frozen(game_id))

        await self.claim(game_id, claimant=self.slot1, winner=self.slot1)
        await assert_locked()
        await self.record(game_id, winner=self.slot1)
        await assert_locked()

    async def test_an_organizer_reopening_a_side_pick_starts_it_empty_and_binds_the_new_choice(self) -> None:
        await self.start(ban_ruleset(with_side_pick=True))
        await self.act(self.slot1, 1, action="side_pick")  # defence: the later `side:attack` ban is slot 2's
        self.assertEqual([self.slot2], (await self.state())["acting_team_ids"])
        game_id = await self.game_id(1)

        await self.admin_reopen()
        self.assertEqual({self.slot1: None, self.slot2: None}, await self.sides(game_id))
        self.assertTrue(all(step.is_unbound for step in (await self.steps())[1:]))
        drafts = [
            (index, team, items) for _id, index, team, state, items in await self.submissions() if state == pbr.DRAFT
        ]
        self.assertEqual([(0, self.slot1, [])], drafts)

        await self.act(self.slot1, 0, action="side_pick")  # attack this time
        self.assertEqual({self.slot1: "attack", self.slot2: "defence"}, await self.sides(game_id))
        with self.assertRaises(BaseAPIException):
            await self.act(self.slot2, FIRST_HERO)
        await self.act(self.slot1, FIRST_HERO)

    async def test_an_organizer_cannot_reopen_a_side_somebody_played_on(self) -> None:
        await self.start(ban_ruleset(with_side_pick=True))
        await self.act(self.slot1, 0, action="side_pick")
        game_id = await self.game_id(1)
        await self.claim(game_id, claimant=self.slot1, winner=self.slot1)
        frozen = await self.frozen(game_id)
        self.assertEqual("side_locked", await self.refused(self.admin_reopen()))
        self.assertEqual(frozen, await self.frozen(game_id))

    async def test_a_hero_reset_takes_back_unplayed_sides_and_keeps_a_played_games(self) -> None:
        await self.start(ban_ruleset(with_side_pick=True))
        await self.act(self.slot1, 0, action="side_pick")
        await self.play_round()
        await self.confirm_position(1, winner=self.slot1)
        await self.reconcile()
        await self.act(self.slot1, 1, action="side_pick")  # the FIXED opener picks round 2's side too
        first, second = await self.game_id(1), await self.game_id(2)
        played = {self.slot1: "attack", self.slot2: "defence"}
        self.assertEqual({self.slot1: "defence", self.slot2: "attack"}, await self.sides(second))

        await self.reset(enums.PickBanKind.HERO)
        self.assertEqual(played, await self.sides(first))
        self.assertEqual({self.slot1: None, self.slot2: None}, await self.sides(second))

        # The replayed round-1 pick chooses the OTHER side; the game it was played on keeps its own.
        await self.act(self.slot1, 1, action="side_pick")
        self.assertEqual(played, await self.sides(first))


# ── a corrected result and the round it opened ──────────────────────────────


class CorrectionCase(PositionCase):
    rotation = enums.FirstBanRotation.RESULT_LOSER_FIRST

    async def asyncSetUp(self) -> None:
        await super().asyncSetUp()
        async with self.Session() as s:
            user = User(name=self.tag)
            s.add(user)
            await s.commit()
            self.actor_id = user.id
        self.audited: list[AsyncSession] = []

    async def asyncTearDown(self) -> None:
        async with self.Session() as s:
            await s.execute(
                sa.delete(AuditLog).where(AuditLog.entity_type == "encounter", AuditLog.entity_id == self.encounter_id)
            )
            await s.execute(sa.delete(User).where(User.id == self.actor_id))
            await s.commit()
        await super().asyncTearDown()

    async def record_audit(self, session: AsyncSession) -> None:
        self.audited.append(session)

    async def correct(self, position: int, *, winner: int, score: int = 3) -> dict:
        game_id = await self.game_id(position)
        async with self.Session() as s:
            return await game_correction_service.correct_game(
                s,
                self.encounter_id,
                game_id=game_id,
                results=self.lines(winner, score),
                actor_user_id=self.actor_id,
                reason="scored backwards",
                audit=self.record_audit,
            )

    async def admin_result(self, game_id: int, *, winner: int, reason: str = "scored backwards") -> dict:
        """Through the real ``rpc.tournament.admin_game_result`` handler, on a
        real session that is rolled back on the way out of a refusal."""
        broker = CapturingBroker()
        pick_ban_admin.register(broker, SimpleNamespace(exception=lambda *a, **k: None))
        data = {
            "identity": make_identity(user_id=self.actor_id, is_superuser=True),
            "id": self.encounter_id,
            "game_id": game_id,
            "payload": {
                "results": [{"encounter_team_id": seat, "score": 3 if seat == winner else 1} for seat in self.seats],
                "reason": reason,
            },
        }
        with patch.object(rpc_helpers.db, "async_session_maker", self.Session):
            return await broker.handlers["rpc.tournament.admin_game_result"](data, None)

    async def audit_rows(self) -> int:
        async with self.Session() as s:
            return await s.scalar(
                sa.select(sa.func.count())
                .select_from(AuditLog)
                .where(
                    AuditLog.entity_type == "encounter",
                    AuditLog.entity_id == self.encounter_id,
                    AuditLog.action == "encounter.game_result",
                )
            )

    async def round_entries(self, round_number: int) -> set[int]:
        async with self.Session() as s:
            return set(
                (
                    await s.execute(
                        sa.select(PickBanEntry.id).where(
                            PickBanEntry.encounter_id == self.encounter_id, PickBanEntry.round == round_number
                        )
                    )
                )
                .scalars()
                .all()
            )

    async def snapshot(self) -> dict:
        """Everything a refused correction must leave exactly as it was."""
        async with self.Session() as s:

            async def rows(query) -> list[tuple]:
                return [tuple(row) for row in await s.execute(query)]

            return {
                "games": await rows(
                    sa.select(EncounterGame.id, EncounterGame.state, EncounterGame.result_version)
                    .where(EncounterGame.encounter_id == self.encounter_id)
                    .order_by(EncounterGame.id)
                ),
                "lines": await rows(
                    sa.select(
                        EncounterGameTeam.game_id,
                        EncounterGameTeam.encounter_team_id,
                        EncounterGameTeam.score,
                        EncounterGameTeam.starting_side,
                    )
                    .where(EncounterGameTeam.encounter_id == self.encounter_id)
                    .order_by(EncounterGameTeam.game_id, EncounterGameTeam.encounter_team_id)
                ),
                "sessions": await rows(
                    sa.select(
                        PickBanSession.resolved_sequence_json, PickBanSession.status, PickBanSession.awaiting_choice
                    ).where(PickBanSession.encounter_id == self.encounter_id)
                ),
                "submissions": await rows(
                    sa.select(PickBanSubmission.id, PickBanSubmission.state)
                    .where(PickBanSubmission.encounter_id == self.encounter_id)
                    .order_by(PickBanSubmission.id)
                ),
                "entries": await rows(
                    sa.select(PickBanEntry.id, PickBanEntry.round, PickBanEntry.status)
                    .where(PickBanEntry.encounter_id == self.encounter_id)
                    .order_by(PickBanEntry.id)
                ),
                "events": await self.events(),
                "outbox": await s.scalar(sa.select(sa.func.count()).select_from(EventOutbox)),
                "encounter": await rows(
                    sa.select(Encounter.status, Encounter.result_status).where(Encounter.id == self.encounter_id)
                ),
                "seats": await rows(
                    sa.select(EncounterTeam.id, EncounterTeam.score, EncounterTeam.active)
                    .where(EncounterTeam.encounter_id == self.encounter_id)
                    .order_by(EncounterTeam.id)
                ),
            }

    async def opened_round_two(self, ruleset: dict | None = None) -> int:
        """Round 1 played, G1 won by slot 1, round 2 appended off it. Returns G1."""
        await self.start(ruleset)
        await self.play_round()
        await self.confirm_position(1, winner=self.slot1)
        await self.reconcile()
        return await self.game_id(1)


class CorrectionRebuildsTheNextRoundTests(CorrectionCase):
    async def test_flipping_the_winner_rebuilds_an_untouched_round_for_the_new_loser(self) -> None:
        first = await self.opened_round_two()
        self.assertEqual([self.slot2], (await self.state())["acting_team_ids"])
        scrapped = await self.round_entries(2)

        commits: list[AsyncSession] = []
        real_commit = AsyncSession.commit

        async def counted(session: AsyncSession) -> None:
            commits.append(session)
            await real_commit(session)

        with patch.object(AsyncSession, "commit", counted):
            envelope = await self.admin_result(first, winner=self.slot2)
        self.assertTrue(envelope["ok"], envelope)
        self.assertEqual(1, len(commits))

        state = await self.state()
        self.assertEqual((2, [self.slot1]), (state["current_round"], state["acting_team_ids"]))
        self.assertEqual([self.slot1, self.slot2, self.slot1], await self.openers())
        rebuilt = await self.round_entries(2)
        self.assertTrue(rebuilt)
        self.assertFalse(scrapped & rebuilt)
        async with self.Session() as s:
            encounter = await s.get_one(Encounter, self.encounter_id)
            game = await s.get_one(EncounterGame, first)
            self.assertEqual((enums.EncounterGameResultSource.ADMIN, 2), (game.result_source, game.result_version))
            self.assertEqual((True, self.slot2), await pick_ban_session_service.round_result(s, encounter, 1))
        self.assertEqual(1, await self.audit_rows())

    async def test_a_round_already_acted_in_refuses_the_correction_before_its_audit(self) -> None:
        first = await self.opened_round_two()
        await self.act(self.slot2, FIRST_HERO)
        frozen = await self.snapshot()

        envelope = await self.admin_result(first, winner=self.slot2)
        self.assertFalse(envelope["ok"], envelope)
        self.assertIn("dependent_round_started", str(envelope["error"]))
        self.assertEqual(frozen, await self.snapshot())
        self.assertEqual(0, await self.audit_rows())

        # A missing reason is refused just as early.
        envelope = await self.admin_result(first, winner=self.slot2, reason="  ")
        self.assertEqual("unprocessable", envelope["error"]["code"], envelope)
        self.assertEqual(frozen, await self.snapshot())
        self.assertEqual(0, await self.audit_rows())

    async def test_a_claimed_next_game_refuses_the_correction(self) -> None:
        await self.opened_round_two()
        await self.claim(await self.game_id(2), claimant=self.slot1, winner=self.slot1)
        self.assertEqual("dependent_round_started", await self.refused(self.correct(1, winner=self.slot2)))
        self.assertEqual([], self.audited)

    async def test_a_score_only_correction_leaves_the_next_round_alone(self) -> None:
        await self.opened_round_two()
        before = ((await self.hero_session()).resolved_sequence_json, await self.round_entries(2))
        await self.correct(1, winner=self.slot1, score=4)
        self.assertEqual(before, ((await self.hero_session()).resolved_sequence_json, await self.round_entries(2)))
        self.assertEqual([self.slot1, self.slot2], await self.openers())
        self.assertEqual(1, len(self.audited))


class CorrectionUnderAnAlternatingOrderTests(CorrectionCase):
    rotation = enums.FirstBanRotation.ALTERNATE

    async def test_an_order_that_ignores_results_reconciles_nothing(self) -> None:
        await self.opened_round_two()
        before = (await self.hero_session()).resolved_sequence_json, await self.round_entries(2), await self.openers()
        await self.correct(1, winner=self.slot2)
        after = (await self.hero_session()).resolved_sequence_json, await self.round_entries(2), await self.openers()
        self.assertEqual(before, after)


class CorrectionUnderAFixedOrderTests(CorrectionUnderAnAlternatingOrderTests):
    rotation = enums.FirstBanRotation.FIXED


class CorrectionReaddressesAPendingChoiceTests(CorrectionCase):
    rotation = enums.FirstBanRotation.RESULT_LOSER_CHOICE

    async def test_a_flipped_winner_hands_the_pending_choice_to_the_new_loser(self) -> None:
        await self.opened_round_two()
        pick_ban = await self.hero_session()
        self.assertEqual((True, self.slot2), (pick_ban.awaiting_choice, pick_ban.pending_chooser_team_id))
        await self.correct(1, winner=self.slot2)
        pick_ban = await self.hero_session()
        self.assertEqual((True, self.slot1), (pick_ban.awaiting_choice, pick_ban.pending_chooser_team_id))


class SidedCorrectionRecoveryTests(CorrectionCase):
    """``dependent_round_started`` has a way out through calls that already exist."""

    discipline = SIDED.code

    async def touched_round_two(self) -> tuple[int, int]:
        """G1 won by slot 1; round 2 opened by slot 2, who picked a side on G2. Returns (G1, G2)."""
        await self.start(ban_ruleset(with_side_pick=True))
        await self.act(self.slot1, 0, action="side_pick")
        await self.play_round()
        await self.confirm_position(1, winner=self.slot1)
        await self.reconcile()
        self.assertEqual([self.slot2], (await self.state())["acting_team_ids"])
        await self.act(self.slot2, 0, action="side_pick")
        self.assertEqual("dependent_round_started", await self.refused(self.correct(1, winner=self.slot2)))
        return await self.game_id(1), await self.game_id(2)

    async def test_undoing_the_next_rounds_side_pick_lets_the_correction_rebuild_it(self) -> None:
        first, second = await self.touched_round_two()
        played = await self.sides(first)
        for seat in self.seats:
            await self.undo(seat)
        self.assertEqual({self.slot1: None, self.slot2: None}, await self.sides(second))

        await self.correct(1, winner=self.slot2)
        state = await self.state()
        self.assertEqual(("side_pick", [self.slot1]), (state["expected_action"], state["acting_team_ids"]))
        self.assertEqual(self.slot1, (await self.openers())[-1])
        self.assertEqual(played, await self.sides(first))

    async def test_a_hero_reset_and_a_replayed_first_round_let_the_correction_rebuild_the_next(self) -> None:
        first, second = await self.touched_round_two()
        played = await self.sides(first)
        await self.reset(enums.PickBanKind.HERO)
        self.assertEqual(played, await self.sides(first))
        self.assertEqual({self.slot1: None, self.slot2: None}, await self.sides(second))
        # Round 1's side step is open again, so G1 cannot be corrected yet.
        self.assertEqual("side_pick_pending", await self.refused(self.correct(1, winner=self.slot2)))

        await self.act(self.slot1, 1, action="side_pick")
        self.assertEqual(played, await self.sides(first))
        await self.play_round()
        await self.reconcile()
        self.assertEqual(self.slot2, (await self.openers())[-1])  # appended off the stored result

        await self.correct(1, winner=self.slot2)
        self.assertEqual(self.slot1, (await self.openers())[-1])
        state = await self.state()
        self.assertEqual((2, [self.slot1]), (state["current_round"], state["acting_team_ids"]))

    async def test_a_played_next_game_is_recovered_through_resets_and_a_replacement_first_game(self) -> None:
        await self.start(ban_ruleset(with_side_pick=True))
        await self.act(self.slot1, 0, action="side_pick")
        await self.play_round()
        await self.confirm_position(1, winner=self.slot1)
        await self.reconcile()
        await self.act(self.slot2, 0, action="side_pick")
        await self.play_round()
        await self.confirm_position(2, winner=self.slot1)
        old = (await self.game_id(1), await self.game_id(2))
        self.assertEqual("dependent_round_started", await self.refused(self.correct(1, winner=self.slot2)))

        async def history() -> list[tuple]:
            async with self.Session() as s:
                return [
                    tuple(row)
                    for row in await s.execute(
                        sa.select(
                            EncounterGameTeam.game_id,
                            EncounterGameTeam.encounter_team_id,
                            EncounterGameTeam.score,
                            EncounterGameTeam.starting_side,
                        )
                        .where(EncounterGameTeam.game_id.in_(old))
                        .order_by(EncounterGameTeam.game_id, EncounterGameTeam.encounter_team_id)
                    )
                ]

        played = await history()
        async with self.Session() as s:
            # A Bo3 at 2:0 under `games >= best_of` is still open: no result reopen is owed first.
            encounter = await s.get_one(Encounter, self.encounter_id)
            self.assertNotEqual(enums.EncounterResultStatus.CONFIRMED, encounter.result_status)
        await self.reset(enums.PickBanKind.MAP)
        await self.reset(enums.PickBanKind.HERO)

        await self.act(self.slot1, 0, action="side_pick")
        replacement = await self.game_id(1)
        self.assertNotIn(replacement, old)
        await self.play_round()
        await self.correct(1, winner=self.slot2)
        await self.reconcile()
        self.assertEqual(self.slot1, (await self.openers())[-1])
        state = await self.state()
        self.assertEqual((2, [self.slot1]), (state["current_round"], state["acting_team_ids"]))

        # The retired games are history: cancelled, with their numbers and sides as they were played.
        self.assertEqual(played, await history())
        for game_id in old:
            self.assertEqual(enums.EncounterGameState.CANCELLED, (await self.game_row(game_id))[0])


# ── League of Legends: the real side-selection preset ───────────────────────

LOL_CHAMPION_ID_BASE = 1_920_000_000
LOL_CHAMPIONS = {
    LOL_CHAMPION_ID_BASE + n: cls for n, cls in enumerate(("fighter", "mage", "marksman", "support"), start=1)
}


class LolSideSelectionLoopTests(PositionCase):
    discipline = "lol"
    hero_discipline = "lol"

    def pool_rows(self) -> dict[int, str]:
        return dict(LOL_CHAMPIONS)

    async def test_each_game_opens_on_a_side_its_opener_picks_and_the_loser_opens_the_next(self) -> None:
        preset = {preset.id: preset for preset in pbr.presets_for("lol")}["lol_side_selection"]
        self.rotation = enums.FirstBanRotation(preset.first_ban_rotation)
        self.assertEqual(enums.FirstBanRotation.RESULT_LOSER_FIRST, self.rotation)

        pick_ban = await self.start(preset.ruleset.to_json())
        self.assertEqual("result_loser_first", pick_ban.pool_json["rotation"])
        # G1's opener is the seed resolution's: no bracket position, so the first slot.
        self.assertEqual(
            (self.slot1, enums.VetoSeedSource.FALLBACK_FIRST_SLOT), (pick_ban.first_team_id, pick_ban.seed_source)
        )
        state = await self.state(viewer=self.slot1)
        self.assertEqual((["blue", "red"], ["side_pick"]), (state["sides"], state["allowed_actions"]))

        await self.act(self.slot1, 0, action="side_pick")
        self.assertEqual({self.slot1: "blue", self.slot2: "red"}, await self.sides(await self.game_id(1)))
        # Game 2 does not exist before game 1 has a result.
        await self.reconcile()
        async with self.Session() as s:
            self.assertEqual(
                [1], [game.position for game in await encounter_game_service.list_games(s, self.encounter_id)]
            )

        await self.confirm_position(1, winner=self.slot1)
        await self.reconcile()
        state = await self.state()
        self.assertEqual((2, [self.slot2]), (state["current_round"], state["acting_team_ids"]))
        await self.act(self.slot2, 1, action="side_pick")
        self.assertEqual({self.slot2: "red", self.slot1: "blue"}, await self.sides(await self.game_id(2)))
        # A side-only round spends no champion.
        self.assertEqual({"available"}, {str(entry["status"]) for entry in (await self.state())["pool"]})


def _unused() -> None:
    _ = EncounterGame
