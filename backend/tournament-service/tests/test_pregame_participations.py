"""The pre-game room over participations: readiness, actors, undo and sides.

The six cases Task 8 names, against the real Postgres -- because every one of
them lives in a constraint as much as in Python: ``uq_readiness_team``,
``uq_pick_ban_submission_step_team_attempt`` (NULLS NOT DISTINCT),
``ck_pick_ban_entry_picked_by`` and ``uq_game_team_side``. A sqlite double would
pass while the deploy failed.

What is NOT here: the pure actor vocabulary (``shared/tests/test_disciplines.py``
and ``test_pick_ban_rules_*``), which needs no database at all.
"""

from __future__ import annotations

import asyncio
import itertools
import os
import sys
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import patch

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import async_sessionmaker

from shared.core import enums
from shared.core.errors import BaseAPIException
from shared.disciplines import DISCIPLINES, DisciplineSpec
from shared.domain import pick_ban_rules as pbr
from shared.models.catalog.hero import Hero
from shared.models.encounter import Encounter, EncounterTeam, ScoringRule
from shared.models.encounter.game import EncounterGame, EncounterGameTeam
from shared.models.encounter.pick_ban import PickBanSession
from shared.models.encounter.readiness import EncounterReadiness
from shared.models.encounter.room_event import EncounterRoomEvent
from shared.models.tenancy.workspace import Workspace
from shared.models.tournament.pick_ban import PickBanConfig, PickBanConfigItem
from shared.models.tournament.team import Team
from shared.models.tournament.tournament import Tournament
from shared.services.encounter.participants import place_team
from shared.testing import create_test_async_engine
from shared.testing.db import ensure_test_postgres
from src.services.encounter.pick_ban_action import pick_ban_action_service
from src.services.encounter.pick_ban_session import pick_ban_session_service, resolved_steps
from src.services.encounter.pick_ban_undo import pick_ban_undo_service
from src.services.encounter.pregame_rooms import pregame_rooms_service

_TAG = itertools.count()

#: A stand-in for the first discipline that declares sides. V1 ships none, so
#: the side-pick half of the room is exercised against this rather than left
#: untested until V3.
SIDED = DisciplineSpec("sided", "Sided Game", ("attack", "defence"))

#: A hero pool wide enough for one blind round of two bans a side.
HEROES = {1: enums.HeroClass.tank, 2: enums.HeroClass.damage, 3: enums.HeroClass.support, 4: enums.HeroClass.damage}


def hero_ruleset(*, blind: bool = False, count: int = 1) -> dict:
    """One open (or blind) ban step per participation, in v1 actor spelling."""
    return {
        "version": 2,
        "timer_seconds": None,
        "on_timeout": "wait",
        "phases": [
            {
                "id": "main",
                "name": None,
                "when": {},
                "pool_filter": {},
                "generator": None,
                "steps": (
                    [
                        {
                            "id": "b1",
                            "action": "ban",
                            "actors": "both",
                            "count": count,
                            "min": None,
                            "blind": True,
                            "target": None,
                            "lifetime": 1,
                            "timer_seconds": None,
                            "on_timeout": None,
                            "dispute": {"enabled": False, "max": 0},
                            "eligible": {},
                            "constraints": [],
                        }
                    ]
                    if blind
                    else [
                        {
                            "id": step_id,
                            "action": "ban",
                            "actors": actors,
                            "count": 1,
                            "min": None,
                            "blind": False,
                            "target": None,
                            "lifetime": 1,
                            "timer_seconds": None,
                            "on_timeout": None,
                            "dispute": {"enabled": False, "max": 0},
                            "eligible": {},
                            "constraints": [],
                        }
                        # ``home``/``away`` on purpose: the stored v1 spelling
                        # must still resolve, to slots 1 and 2.
                        for step_id, actors in (("b1", "home"), ("b2", "away"))
                    ]
                ),
            }
        ],
    }


class RoomCase(IsolatedAsyncioTestCase):
    """A workspace, a tournament, two teams and one two-seat encounter."""

    if sys.platform == "win32":
        loop_factory = asyncio.SelectorEventLoop

    discipline = "overwatch"

    async def asyncSetUp(self) -> None:
        # The post-commit healer runs in its OWN session on a background task;
        # here it would race this suite's deliberate step-by-step writes (and
        # deadlock against them). ``test_room_reconcile`` is where it is driven.
        self._no_reconcile = patch("src.services.encounter.room_reconcile._stage", lambda *a, **k: None)
        self._no_reconcile.start()
        self.addCleanup(self._no_reconcile.stop)
        ensure_test_postgres()
        self.engine = create_test_async_engine()
        self.Session = async_sessionmaker(self.engine, expire_on_commit=False)
        self.tag = f"pb-{os.getpid()}-{next(_TAG)}"
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
                end_formula="games >= best_of or max_wins * 2 > best_of",
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
                best_of=1,
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

    async def encounter(self, s) -> Encounter:
        return await s.get_one(Encounter, self.encounter_id)

    async def configure(self, ruleset: dict) -> None:
        async with self.Session() as s:
            config = PickBanConfig(
                tournament_id=self.tournament_id,
                kind=enums.PickBanKind.HERO,
                mode=enums.MapVetoMode.POOL,
                first_ban_rotation=enums.FirstBanRotation.FIXED,
                ruleset_json=ruleset,
            )
            config.items = [
                PickBanConfigItem(item_id=item_id, sort_order=index) for index, item_id in enumerate(HEROES)
            ]
            s.add(config)
            await s.commit()

    async def ready_all(self) -> dict[str, bool]:
        async with self.Session() as s:
            encounter = await self.encounter(s)
            readiness: dict[str, bool] = {}
            for seat in self.seats:
                readiness = await pick_ban_session_service.mark_ready(s, encounter, seat, None)
            return readiness

    async def open_room(self) -> PickBanSession:
        async with self.Session() as s:
            encounter = await self.encounter(s)
            pick_ban = await pick_ban_session_service.ensure_pick_ban_session(s, encounter, enums.PickBanKind.HERO)
            assert pick_ban is not None
            return pick_ban


# ── readiness is per participation ──────────────────────────────────────────


class ReadinessTests(RoomCase):
    async def test_readiness_is_keyed_by_participation_and_gates_the_room(self) -> None:
        async with self.Session() as s:
            self.assertEqual(
                {str(seat): False for seat in self.seats},
                await pick_ban_session_service.get_readiness(s, self.encounter_id),
            )
            self.assertFalse(await pick_ban_session_service.all_ready(s, self.encounter_id))

        await self.configure(hero_ruleset())
        async with self.Session() as s:
            encounter = await self.encounter(s)
            await pick_ban_session_service.mark_ready(s, encounter, self.slot1, None)
            # One seat ready is not the room ready.
            self.assertFalse(await pick_ban_session_service.all_ready(s, self.encounter_id))
            self.assertIsNone(await pick_ban_session_service.creation_plan(s, encounter, enums.PickBanKind.HERO))
            readiness = await pick_ban_session_service.mark_ready(s, encounter, self.slot2, None)
        self.assertEqual({str(self.slot1): True, str(self.slot2): True}, readiness)

        async with self.Session() as s:
            rows = (
                (
                    await s.execute(
                        sa.select(EncounterReadiness.encounter_team_id).where(
                            EncounterReadiness.encounter_id == self.encounter_id
                        )
                    )
                )
                .scalars()
                .all()
            )
        self.assertEqual(sorted(self.seats), sorted(rows))

    async def test_marking_the_same_participation_twice_writes_one_row(self) -> None:
        await self.ready_all()
        await self.ready_all()
        async with self.Session() as s:
            count = await s.scalar(
                sa.select(sa.func.count())
                .select_from(EncounterReadiness)
                .where(EncounterReadiness.encounter_id == self.encounter_id)
            )
        self.assertEqual(2, count)

    async def test_a_retired_seat_s_confirmation_is_not_reported(self) -> None:
        await self.ready_all()
        async with self.Session() as s:
            seat = await s.get_one(EncounterTeam, self.slot2)
            seat.active = False
            await s.commit()
        async with self.Session() as s:
            readiness = await pick_ban_session_service.get_readiness(s, self.encounter_id)
        self.assertEqual({str(self.slot1): True}, readiness)


# ── the resolved sequence names participations ──────────────────────────────


class ResolvedActorTests(RoomCase):
    async def test_stored_home_and_away_actors_open_the_room_on_slots_one_and_two(self) -> None:
        await self.configure(hero_ruleset())
        await self.ready_all()
        pick_ban = await self.open_room()

        async with self.Session() as s:
            teams = await pick_ban_session_service.teams_of(s, self.encounter_id)
            steps = resolved_steps(pick_ban, teams)
        self.assertEqual([[self.slot1], [self.slot2]], [step.actors for step in steps])
        # And the stored JSON really holds ids, not sides.
        self.assertEqual([[self.slot1], [self.slot2]], [row["actors"] for row in pick_ban.resolved_sequence_json])

    async def test_the_session_snapshots_the_config_pool(self) -> None:
        await self.configure(hero_ruleset())
        await self.ready_all()
        pick_ban = await self.open_room()
        self.assertEqual(sorted(HEROES), sorted(pick_ban.pool_json["items"]))
        self.assertEqual("pool", pick_ban.pool_json["mode"])
        self.assertTrue(pick_ban.pool_json["progressive"])  # hero rounds are per map

        # Editing the config afterwards cannot move the running room's pool.
        async with self.Session() as s:
            config = (await s.execute(sa.select(PickBanConfig))).scalars().first()
            await s.execute(sa.delete(PickBanConfigItem).where(PickBanConfigItem.pick_ban_config_id == config.id))
            await s.commit()
        async with self.Session() as s:
            again = await pick_ban_session_service.get_pick_ban_session(s, self.encounter_id, enums.PickBanKind.HERO)
        self.assertEqual(sorted(HEROES), sorted(again.pool_json["items"]))

    async def test_only_the_acting_participation_may_take_the_step(self) -> None:
        await self.configure(hero_ruleset())
        await self.ready_all()
        await self.open_room()

        async with self.Session() as s:
            with self.assertRaises(BaseAPIException) as refused:
                await pick_ban_action_service.perform_pick_ban_action(
                    s, self.encounter_id, enums.PickBanKind.HERO, self.slot2, item_id=1, action="ban"
                )
            self.assertEqual(400, refused.exception.status_code)

        async with self.Session() as s:
            state = await pick_ban_action_service.perform_pick_ban_action(
                s, self.encounter_id, enums.PickBanKind.HERO, self.slot1, item_id=1, action="ban"
            )
        self.assertEqual([self.slot2], state["acting_team_ids"])
        banned = [entry for entry in state["pool"] if entry["status"] == "banned"]
        self.assertEqual([("team", self.slot1)], [(e["picked_by_kind"], e["picked_by_team_id"]) for e in banned])

    async def test_a_blind_draft_is_private_to_its_own_participation(self) -> None:
        await self.configure(hero_ruleset(blind=True, count=1))
        await self.ready_all()
        await self.open_room()

        async with self.Session() as s:
            await pick_ban_action_service.submit_items(
                s,
                self.encounter_id,
                enums.PickBanKind.HERO,
                self.slot1,
                items=[{"item_id": 1, "target_player_id": None}],
                lock=True,
            )
        async with self.Session() as s:
            opponent = await pick_ban_action_service.get_pick_ban_state(
                s, self.encounter_id, enums.PickBanKind.HERO, viewer=self.slot2
            )
        self.assertEqual([], [row for row in opponent["submissions"] if row["encounter_team_id"] == self.slot1])
        self.assertEqual(
            {str(self.slot1): True, str(self.slot2): False},
            {k: v["locked"] for k, v in opponent["step_progress"].items()},
        )


# ── undo consent is between participations ──────────────────────────────────


class UndoConsentTests(RoomCase):
    async def test_undo_applies_only_once_the_other_participation_consents(self) -> None:
        await self.configure(hero_ruleset())
        await self.ready_all()
        await self.open_room()
        async with self.Session() as s:
            await pick_ban_action_service.perform_pick_ban_action(
                s, self.encounter_id, enums.PickBanKind.HERO, self.slot1, item_id=1, action="ban"
            )

        async with self.Session() as s:
            first = await pick_ban_undo_service.perform_undo(s, self.encounter_id, enums.PickBanKind.HERO, self.slot1)
        self.assertEqual(self.slot1, first["requested_by_team_id"])
        self.assertEqual([1], first["item_ids"])

        # The SAME participation asking again is still one request, not consent.
        async with self.Session() as s:
            again = await pick_ban_undo_service.perform_undo(s, self.encounter_id, enums.PickBanKind.HERO, self.slot1)
        self.assertEqual(self.slot1, again["requested_by_team_id"])

        async with self.Session() as s:
            applied = await pick_ban_undo_service.perform_undo(s, self.encounter_id, enums.PickBanKind.HERO, self.slot2)
        self.assertEqual([], applied["item_ids"])
        async with self.Session() as s:
            pick_ban = await pick_ban_session_service.get_pick_ban_session(s, self.encounter_id, enums.PickBanKind.HERO)
            self.assertIsNone(pick_ban.undo_requested_by_team_id)
            state = await pick_ban_action_service.get_pick_ban_state(
                s, self.encounter_id, enums.PickBanKind.HERO, viewer=self.slot1
            )
        self.assertEqual([self.slot1], state["acting_team_ids"])

    async def test_a_withdrawal_clears_the_request(self) -> None:
        await self.configure(hero_ruleset())
        await self.ready_all()
        await self.open_room()
        async with self.Session() as s:
            await pick_ban_action_service.perform_pick_ban_action(
                s, self.encounter_id, enums.PickBanKind.HERO, self.slot1, item_id=1, action="ban"
            )
        async with self.Session() as s:
            await pick_ban_undo_service.perform_undo(s, self.encounter_id, enums.PickBanKind.HERO, self.slot1)
        async with self.Session() as s:
            withdrawn = await pick_ban_undo_service.perform_undo(
                s, self.encounter_id, enums.PickBanKind.HERO, self.slot1, consent=False
            )
        self.assertIsNone(withdrawn["requested_by_team_id"])
        self.assertEqual([1], withdrawn["item_ids"])  # still undoable, just nobody asked


# ── sides ───────────────────────────────────────────────────────────────────


class SideTests(RoomCase):
    discipline = SIDED.code

    async def test_a_side_pick_writes_both_participations_starting_side(self) -> None:
        async with self.Session() as s:
            encounter = await self.encounter(s)
            self.assertEqual(("attack", "defence"), pick_ban_action_service.side_codes(encounter))

        async with self.Session() as s:
            encounter = await self.encounter(s)
            game = await pick_ban_action_service.games.open_game(s, encounter, position=1)
            await s.commit()
            game_id = game.id

        async with self.Session() as s:
            encounter = await self.encounter(s)
            rt = await self._runtime(s, encounter)
            step = rt.steps[0]
            await pick_ban_action_service._apply_side_pick(s, rt, step, self.slot1, "defence")
            await s.commit()

        async with self.Session() as s:
            rows = (
                (await s.execute(sa.select(EncounterGameTeam).where(EncounterGameTeam.game_id == game_id)))
                .scalars()
                .all()
            )
        self.assertEqual(
            {self.slot1: "defence", self.slot2: "attack"},
            {row.encounter_team_id: row.starting_side for row in rows},
        )

    async def test_two_participations_cannot_start_a_game_on_the_same_side(self) -> None:
        async with self.Session() as s:
            encounter = await self.encounter(s)
            game = await pick_ban_action_service.games.open_game(s, encounter, position=1)
            await s.commit()
            game_id = game.id
        async with self.Session() as s:
            rows = (
                (await s.execute(sa.select(EncounterGameTeam).where(EncounterGameTeam.game_id == game_id)))
                .scalars()
                .all()
            )
            for row in rows:
                row.starting_side = "attack"
            with self.assertRaises(Exception) as duplicate:
                await s.commit()
        self.assertIn("uq_game_team_side", str(duplicate.exception))

    def test_a_side_pick_is_refused_for_a_discipline_without_sides(self) -> None:
        """Overwatch declares no sides, so a room of it hands none out -- and a
        card wider than the discipline's side count hands none out either."""
        self.assertEqual((), pick_ban_action_service.side_codes(SimpleNamespace(discipline="overwatch", slot_count=2)))
        self.assertEqual((), pick_ban_action_service.side_codes(SimpleNamespace(discipline=SIDED.code, slot_count=3)))

    async def _runtime(self, s, encounter):
        """A `_Runtime` whose single step is a side pick taken by slot 1."""
        await self.configure(hero_ruleset())
        await self.ready_all()
        pick_ban = await pick_ban_session_service.ensure_pick_ban_session(
            s, encounter, enums.PickBanKind.HERO, commit=False
        )
        rt = await pick_ban_action_service._load(s, pick_ban, encounter)
        rt.steps = [
            rt.steps[0].model_copy(update={"action": "side_pick", "actors": [self.slot1], "count": 1, "min": 1})
        ]
        return rt


# ── the journal and the organizer's overview ────────────────────────────────


class JournalTests(RoomCase):
    """The room's trail names participations, and outlives a reset (rows are
    keyed by ENCOUNTER exactly so a reset cannot erase the story)."""

    async def test_every_room_row_names_the_participation_that_caused_it(self) -> None:
        await self.configure(hero_ruleset())
        await self.ready_all()
        await self.open_room()
        async with self.Session() as s:
            await pick_ban_action_service.perform_pick_ban_action(
                s, self.encounter_id, enums.PickBanKind.HERO, self.slot1, item_id=1, action="ban"
            )
        async with self.Session() as s:
            rows = (
                await s.execute(
                    sa.select(EncounterRoomEvent.action, EncounterRoomEvent.encounter_team_id)
                    .where(EncounterRoomEvent.encounter_id == self.encounter_id)
                    .order_by(EncounterRoomEvent.id)
                )
            ).all()
        by_action = dict(rows)
        self.assertEqual({self.slot1, self.slot2}, {team_id for action, team_id in rows if action == "ready_marked"})
        self.assertEqual(self.slot1, by_action["acted"])
        # The opener is a participation too, not a side.
        self.assertEqual(self.slot1, by_action["session_opened"])

    async def test_a_reset_keeps_the_story_it_scrapped(self) -> None:
        await self.configure(hero_ruleset())
        await self.ready_all()
        await self.open_room()
        async with self.Session() as s:
            encounter = await self.encounter(s)
            await pick_ban_session_service.reset_pick_ban_session(s, encounter, enums.PickBanKind.HERO)
        async with self.Session() as s:
            actions = (
                (
                    await s.execute(
                        sa.select(EncounterRoomEvent.action).where(EncounterRoomEvent.encounter_id == self.encounter_id)
                    )
                )
                .scalars()
                .all()
            )
        self.assertIn("session_reset", actions)
        self.assertIn("ready_marked", actions)


class OverviewTests(RoomCase):
    """The organizer's tournament-wide list reports seats, not two sides."""

    async def test_a_room_row_carries_its_seats_and_their_readiness(self) -> None:
        await self.configure(hero_ruleset())
        await self.ready_all()
        await self.open_room()
        async with self.Session() as s:
            rooms = await pregame_rooms_service.list_rooms(s, self.tournament_id)
        (row,) = rooms.rooms
        self.assertEqual(self.encounter_id, row.encounter_id)
        self.assertEqual([(1, self.slot1), (2, self.slot2)], [(t.slot, t.encounter_team_id) for t in row.teams])
        self.assertEqual({str(self.slot1): True, str(self.slot2): True}, row.readiness)
        self.assertEqual("hero", row.phase)
        self.assertEqual([self.slot1], row.hero.acting_team_ids)

    async def test_an_unseated_card_reports_teams_unknown(self) -> None:
        await self.configure(hero_ruleset())
        async with self.Session() as s:
            seat = await s.get_one(EncounterTeam, self.slot2)
            seat.active = False
            await s.commit()
        async with self.Session() as s:
            rooms = await pregame_rooms_service.list_rooms(s, self.tournament_id)
        (row,) = rooms.rooms
        self.assertEqual("teams_unknown", row.phase)
        self.assertEqual("teams_unknown", row.hero.reason)


def _unused() -> None:
    """Keep the imports the suite documents but does not call directly."""
    _ = (Hero, EncounterGame, pbr)
