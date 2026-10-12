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
import os
import sys
from datetime import UTC, datetime, timedelta
from unittest import IsolatedAsyncioTestCase
from unittest.mock import patch

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import async_sessionmaker

from shared.core import enums
from shared.core.errors import BaseAPIException
from shared.disciplines import DISCIPLINES
from shared.models.encounter import Encounter, EncounterTeam, ScoringRule
from shared.models.encounter.game import EncounterGame, EncounterGameTeam
from shared.models.encounter.pick_ban import PickBanSession
from shared.models.encounter.room_event import EncounterRoomEvent
from shared.models.tenancy.workspace import Workspace
from shared.models.tournament.pick_ban import PickBanConfig, PickBanConfigItem
from shared.models.tournament.team import Team
from shared.models.tournament.tournament import Tournament
from shared.services.encounter.participants import place_team
from shared.testing import create_test_async_engine
from shared.testing.db import ensure_test_postgres
from src.services.encounter import room_control
from src.services.encounter.games import GameResultIn, encounter_game_service
from src.services.encounter.pick_ban_action import pick_ban_action_service
from src.services.encounter.pick_ban_session import pick_ban_session_service, resolved_steps
from tests.test_pregame_participations import HEROES, SIDED

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
    rotation = enums.FirstBanRotation.FIXED

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
        DISCIPLINES.setdefault(SIDED.code, SIDED)
        async with self.Session() as s:
            await s.execute(
                sa.text("INSERT INTO catalog.discipline (code, name) VALUES (:c, :n) ON CONFLICT DO NOTHING"),
                {"c": self.discipline, "n": self.discipline},
            )
            for hero_id, role in HEROES.items():
                await s.execute(
                    sa.text(
                        "INSERT INTO overwatch.hero (id, slug, name, image_path, type)"
                        " VALUES (:id, :slug, :name, '', :type) ON CONFLICT (id) DO NOTHING"
                    ),
                    {"id": hero_id, "slug": f"h{hero_id}", "name": f"H{hero_id}", "type": role.name},
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
    async def start(self, ruleset: dict | None = None) -> PickBanSession:
        async with self.Session() as s:
            config = PickBanConfig(
                tournament_id=self.tournament_id,
                kind=enums.PickBanKind.HERO,
                mode=enums.MapVetoMode.POOL,
                first_ban_rotation=self.rotation,
                ruleset_json=ruleset or ban_ruleset(),
            )
            config.items = [
                PickBanConfigItem(item_id=item_id, sort_order=index) for index, item_id in enumerate(HEROES)
            ]
            s.add(config)
            await s.commit()
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

    async def play_round(self, items: tuple[int, int] = (1, 2)) -> None:
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
                    s, self.encounter_id, enums.PickBanKind.HERO, self.slot1, item_id=1, action="ban"
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
        await self.act(self.slot1, 1)

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
        # Nothing may start on a position whose side is still undecided.
        async with self.Session() as s:
            games = await encounter_game_service.list_games(s, self.encounter_id)
        self.assertTrue(all(game.state == enums.EncounterGameState.PLANNED for game in games))

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
        self.assertEqual([None, None], [step.actors_token for step in steps[1:]])
        self.assertEqual([[self.slot2], [self.slot1]], [step.actors for step in steps[1:]])
        self.assertEqual(
            {self.slot1: "defence", self.slot2: "attack"},
            {row.encounter_team_id: row.starting_side for row in rows},
        )

        # And the room now takes the bound step from the right seat.
        self.assertEqual([self.slot2], (await self.state())["acting_team_ids"])


def _unused() -> None:
    _ = EncounterGame
