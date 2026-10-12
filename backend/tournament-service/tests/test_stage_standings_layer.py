"""Stages, generation, standings, Challonge and scrims over the encounter layer.

The five cases Task 7 names, against the real Postgres: what a stage's
``scoring`` block writes (``encounter.scoring_rule``), what generation writes
(``slot_count``, ``scoring_rule_id``, ``workspace_id``, ``discipline`` and a
``tournament.bracket_encounter`` row), how a duel's and a lobby's standings are
read off ``encounter.team``, and that a scrim room's claim fills slot 2 through
``place_team``.

Not a unit suite: every rule here lives in a constraint as much as in Python
(``stage.scoring_rule_id`` NOT NULL, ``ck_encounter_confirmed_completed``, the
partial unique index on an active slot), so a sqlite double would pass while the
deploy failed.
"""

from __future__ import annotations

import asyncio
import itertools
import os
import sys
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import async_sessionmaker

from shared.core import enums
from shared.core.errors import BaseAPIException
from shared.models.encounter import Encounter, EncounterTeam, ScoringRule
from shared.models.identity.auth_user import AuthUser
from shared.models.tenancy.workspace import Workspace
from shared.models.tournament.bracket_encounter import BracketEncounter
from shared.models.tournament.scrim import ScrimRoom
from shared.models.tournament.stage import Stage, StageItem, StageItemInput
from shared.models.tournament.team import Team
from shared.models.tournament.tournament import Tournament
from shared.services.encounter.participants import active_teams, place_team, vacate_slot
from shared.services.encounter.result import apply_result
from shared.testing import create_test_async_engine
from shared.testing.db import ensure_test_postgres
from src import schemas
from src.services.admin.stage import rule_values, stage_service
from src.services.challonge import sync as challonge_sync
from src.services.scrim.service import _free_side, scrim_service
from src.services.standings.service import Seat, StageEncounter, standings_service

_TAG = itertools.count()


class StageLayerCase(IsolatedAsyncioTestCase):
    """A workspace, a tournament and four teams; stages are built per test."""

    if sys.platform == "win32":
        loop_factory = asyncio.SelectorEventLoop

    async def asyncSetUp(self) -> None:
        ensure_test_postgres()
        self.engine = create_test_async_engine()
        self.Session = async_sessionmaker(self.engine, expire_on_commit=False)
        self.tag = f"stg-{os.getpid()}-{next(_TAG)}"
        async with self.Session() as s:
            workspace = Workspace(slug=self.tag, name=self.tag)
            s.add(workspace)
            await s.flush()
            self.workspace_id = workspace.id
            tournament = Tournament(
                workspace_id=workspace.id,
                discipline="overwatch",
                name=self.tag,
                slug=self.tag,
                status=enums.TournamentStatus.LIVE,
            )
            s.add(tournament)
            await s.flush()
            self.tournament_id = tournament.id
            teams = [Team(tournament_id=tournament.id, name=f"T{i}", balancer_name=f"T{i}") for i in range(4)]
            s.add_all(teams)
            await s.commit()
            self.team_ids = [team.id for team in teams]

    async def asyncTearDown(self) -> None:
        async with self.Session() as s:
            await s.execute(sa.delete(Workspace).where(Workspace.id == self.workspace_id))
            await s.commit()
        await self.engine.dispose()

    async def make_stage(
        self,
        stage_type: enums.StageType,
        *,
        scoring: dict | None = None,
        teams: list[int] | None = None,
        name: str = "S",
    ) -> Stage:
        """One stage through the admin service, optionally with a seeded group."""
        async with self.Session() as s:
            stage = await stage_service.create_stage(
                s,
                self.tournament_id,
                schemas.StageCreate(
                    name=name,
                    stage_type=stage_type,
                    order=1,
                    **({"scoring": schemas.StageScoring(**scoring)} if scoring else {}),
                ),
            )
            item = StageItem(stage_id=stage.id, name="A", type=enums.StageItemType.GROUP, order=0)
            s.add(item)
            await s.flush()
            for slot, team_id in enumerate(teams or [], 1):
                s.add(
                    StageItemInput(
                        stage_item_id=item.id,
                        slot=slot,
                        input_type=enums.StageItemInputType.FINAL,
                        team_id=team_id,
                    )
                )
            await s.commit()
            return await stage_service.get_stage(s, stage.id)


class StageScoringCrudTests(StageLayerCase):
    """The ``scoring`` block writes ``encounter.scoring_rule`` (D51)."""

    async def test_a_bracket_stage_gets_a_wins_rule_it_never_asked_for(self) -> None:
        stage = await self.make_stage(enums.StageType.SINGLE_ELIMINATION)
        async with self.Session() as s:
            rule = await s.get_one(ScoringRule, stage.scoring_rule_id)
        self.assertEqual("wins", rule.preset)
        self.assertEqual("win", rule.game_formula)
        self.assertEqual("games >= best_of or max_wins * 2 > best_of", rule.end_formula)
        self.assertEqual(self.workspace_id, rule.workspace_id)

    async def test_a_lobby_stage_gets_a_points_rule_with_the_default_column(self) -> None:
        stage = await self.make_stage(enums.StageType.FFA_LEAGUE)
        async with self.Session() as s:
            rule = await s.get_one(ScoringRule, stage.scoring_rule_id)
        self.assertEqual("points", rule.preset)
        self.assertEqual(["score"], [column["key"] for column in rule.columns])
        self.assertEqual("games >= best_of", rule.end_formula)

    async def test_the_block_round_trips_through_the_read(self) -> None:
        stage = await self.make_stage(
            enums.StageType.FFA_LEAGUE,
            scoring={
                "win": 3.0,
                "columns": [{"key": "kills", "label": "Kills"}],
                "placement_points": [10.0, 6.0],
                "formula": "place_pts + kills",
            },
        )
        block = stage.scoring
        self.assertEqual(3.0, block["win"])
        self.assertEqual("points", block["preset"])
        self.assertEqual(["kills"], [column["key"] for column in block["columns"]])
        self.assertEqual([10.0, 6.0], block["placement_points"])
        self.assertEqual("place_pts + kills", block["formula"])
        # And the read schema accepts exactly that shape -- no ``ffa_scoring``.
        read = schemas.StageRead.model_validate(stage, from_attributes=True)
        self.assertEqual("place_pts + kills", read.scoring.formula)
        self.assertFalse(hasattr(read, "ffa_scoring"))

    async def test_an_edit_rewrites_the_same_rule_row(self) -> None:
        """The row is EDITED, never replaced: every encounter points at its id."""
        stage = await self.make_stage(enums.StageType.FFA_LEAGUE)
        rule_id = stage.scoring_rule_id
        async with self.Session() as s:
            updated = await stage_service.update_stage(
                s,
                stage.id,
                schemas.StageUpdate(scoring=schemas.StageScoring(placement_points=[5.0, 3.0, 1.0])),
            )
        self.assertEqual(rule_id, updated.scoring_rule_id)
        async with self.Session() as s:
            rule = await s.get_one(ScoringRule, rule_id)
        self.assertEqual([5.0, 3.0, 1.0], list(rule.placement_points))

    async def test_the_409_after_the_next_stage_was_seeded_stays(self) -> None:
        """A re-ranking edit is refused once a playoff seeded off this stage plays."""
        group = await self.make_stage(enums.StageType.ROUND_ROBIN, teams=self.team_ids[:2], name="Group")
        async with self.Session() as s:
            item = (await stage_service.get_stage(s, group.id)).items[0]
            playoff = await stage_service.create_stage(
                s,
                self.tournament_id,
                schemas.StageCreate(name="Playoff", stage_type=enums.StageType.SINGLE_ELIMINATION, order=2),
            )
            po_item = StageItem(stage_id=playoff.id, name="UB", type=enums.StageItemType.BRACKET_UPPER, order=0)
            s.add(po_item)
            await s.flush()
            # A FINAL input that remembers where it was resolved from, and a
            # started encounter in the item it feeds: that is "already seeded".
            s.add(
                StageItemInput(
                    stage_item_id=po_item.id,
                    slot=1,
                    input_type=enums.StageItemInputType.FINAL,
                    team_id=self.team_ids[0],
                    source_stage_item_id=item.id,
                    source_position=1,
                )
            )
            encounter = Encounter(
                workspace_id=self.workspace_id,
                discipline="overwatch",
                tournament_id=self.tournament_id,
                scoring_rule_id=playoff.scoring_rule_id,
                name="F",
                slot_count=2,
                status=enums.EncounterStatus.PENDING,
            )
            s.add(encounter)
            await s.flush()
            s.add(
                BracketEncounter(
                    encounter_id=encounter.id,
                    tournament_id=self.tournament_id,
                    stage_id=playoff.id,
                    stage_item_id=po_item.id,
                    round=1,
                )
            )
            await s.commit()

        with self.assertRaises(Exception) as ctx:
            async with self.Session() as s:
                await stage_service.update_stage(
                    s,
                    group.id,
                    schemas.StageUpdate(scoring=schemas.StageScoring(preset="points", formula="score")),
                )
        self.assertEqual(409, ctx.exception.status_code)

    async def test_rule_values_maps_the_preset_the_stage_type_implies(self) -> None:
        self.assertEqual("wins", rule_values(enums.StageType.SWISS, {})["preset"])
        self.assertEqual("points", rule_values(enums.StageType.FFA_LEAGUE, {})["preset"])
        # An explicit preset wins over the type's default.
        self.assertEqual("points", rule_values(enums.StageType.SWISS, {"preset": "points"})["preset"])


class GenerationTests(StageLayerCase):
    """Generation writes the five things the encounter layer needs."""

    async def _generate(self, stage_type: enums.StageType, teams: list[int]) -> tuple[Stage, list[Encounter]]:
        stage = await self.make_stage(stage_type, teams=teams)
        async with self.Session() as s:
            encounters = await stage_service.generate_encounters(s, stage.id, notify=False)
        return stage, encounters

    async def _assert_card(self, stage: Stage, encounters: list[Encounter], *, slot_count: int) -> None:
        self.assertTrue(encounters)
        async with self.Session() as s:
            for encounter in encounters:
                row = await s.get_one(Encounter, encounter.id)
                self.assertEqual(self.workspace_id, row.workspace_id)
                self.assertEqual("overwatch", row.discipline)
                self.assertEqual(stage.scoring_rule_id, row.scoring_rule_id)
                self.assertEqual(slot_count, row.slot_count)
                position = await s.get(BracketEncounter, row.id)
                self.assertIsNotNone(position, "generation must write a bracket position")
                self.assertEqual(stage.id, position.stage_id)

    async def test_round_robin(self) -> None:
        stage, encounters = await self._generate(enums.StageType.ROUND_ROBIN, self.team_ids)
        # Four teams meet everyone once.
        self.assertEqual(6, len(encounters))
        await self._assert_card(stage, encounters, slot_count=2)

    async def test_single_elimination(self) -> None:
        stage, encounters = await self._generate(enums.StageType.SINGLE_ELIMINATION, self.team_ids)
        self.assertEqual(3, len(encounters))
        await self._assert_card(stage, encounters, slot_count=2)

    async def test_double_elimination(self) -> None:
        stage, encounters = await self._generate(enums.StageType.DOUBLE_ELIMINATION, self.team_ids)
        await self._assert_card(stage, encounters, slot_count=2)
        async with self.Session() as s:
            rounds = (
                await s.execute(
                    sa.select(BracketEncounter.round).where(BracketEncounter.stage_id == stage.id).distinct()
                )
            ).scalars()
        self.assertTrue(any(round_number < 0 for round_number in rounds), "a DE bracket has a lower bracket")

    async def test_swiss(self) -> None:
        stage, encounters = await self._generate(enums.StageType.SWISS, self.team_ids)
        # Four teams and the default five max rounds: a Swiss allowed a full
        # circle IS a round robin, and the generator says so.
        self.assertEqual(6, len(encounters))
        await self._assert_card(stage, encounters, slot_count=2)

    async def test_ffa_lobby_seats_the_whole_group(self) -> None:
        stage, encounters = await self._generate(enums.StageType.FFA_LEAGUE, self.team_ids)
        self.assertEqual(1, len(encounters))
        await self._assert_card(stage, encounters, slot_count=4)
        async with self.Session() as s:
            seats = await active_teams(s, encounters[0].id)
        self.assertEqual([1, 2, 3, 4], [seat.slot for seat in seats])
        self.assertEqual(self.team_ids, [seat.team_id for seat in seats])

    async def test_generation_seats_every_pairing(self) -> None:
        _stage, encounters = await self._generate(enums.StageType.ROUND_ROBIN, self.team_ids)
        async with self.Session() as s:
            for encounter in encounters:
                seats = await active_teams(s, encounter.id)
                self.assertEqual([1, 2], [seat.slot for seat in seats])
                self.assertTrue(all(seat.team_id is not None for seat in seats))


class StandingsTests(StageLayerCase):
    """Duels and lobbies rank off ``encounter.team.score``/``placement``."""

    @staticmethod
    def _duel(encounter_id: int, round_number: int, winner: int, loser: int, *, scores=(2, 0)) -> StageEncounter:
        return StageEncounter(
            id=encounter_id,
            round=round_number,
            stage_id=1,
            stage_item_id=1,
            completed=True,
            seats=(
                Seat(team_id=winner, slot=1, score=scores[0], placement=1),
                Seat(team_id=loser, slot=2, score=scores[1], placement=2),
            ),
        )

    async def test_a_group_ranks_by_place_and_sums_score_differential(self) -> None:
        from src.services.standings.service import prepare_teams_for_groups

        ranked = prepare_teams_for_groups(
            [self._duel(1, 1, 10, 20), self._duel(2, 1, 10, 30, scores=(2, 1))],
            win_points=3.0,
            draw_points=1.0,
            loss_points=0.0,
        )
        by_id = {team.team_id: team for team in ranked}
        self.assertEqual(6.0, by_id[10].points)
        self.assertEqual(2, by_id[10].wins)
        self.assertEqual(3, by_id[10].score_differential)
        self.assertEqual(-2, by_id[20].score_differential)

    async def test_a_drawn_duel_pays_both_sides_the_draw(self) -> None:
        from src.services.standings.service import prepare_teams_for_groups

        drawn = StageEncounter(
            id=1,
            round=1,
            stage_id=1,
            stage_item_id=1,
            completed=True,
            seats=(Seat(10, 1, 1.0, 1), Seat(20, 2, 1.0, 1)),
        )
        ranked = {team.team_id: team for team in prepare_teams_for_groups([drawn], draw_points=1.0)}
        self.assertEqual((0, 1, 0), (ranked[10].wins, ranked[10].draws, ranked[10].loses))
        self.assertEqual(1.0, ranked[20].points)

    async def test_a_lobby_in_a_group_pays_the_place_and_skips_the_differential(self) -> None:
        """N > 2 has no score differential, so it contributes none (plan §5)."""
        from src.services.standings.service import prepare_teams_for_groups

        lobby = StageEncounter(
            id=1,
            round=1,
            stage_id=1,
            stage_item_id=1,
            completed=True,
            seats=(Seat(10, 1, 13.0, 1), Seat(20, 2, 12.0, 2), Seat(30, 3, 7.0, 3)),
        )
        ranked = {team.team_id: team for team in prepare_teams_for_groups([lobby], win_points=3.0)}
        self.assertEqual(3.0, ranked[10].points)
        self.assertEqual(1, ranked[10].wins)
        self.assertEqual(1, ranked[20].loses)
        self.assertEqual(0, ranked[10].score_differential)
        # Buchholz still sees both other seats as opposition.
        self.assertEqual([20, 30], sorted(ranked[10].opponents))

    async def test_a_completed_duel_with_no_placement_is_placed_by_score(self) -> None:
        unplaced = StageEncounter(
            id=1,
            round=1,
            stage_id=1,
            stage_item_id=None,
            completed=True,
            seats=(Seat(10, 1, 2.0, None), Seat(20, 2, 1.0, None)),
        )
        self.assertEqual({10: 1, 20: 2}, unplaced.places())
        self.assertEqual(10, unplaced.winner())

    async def test_the_loader_flattens_a_stage_into_seats(self) -> None:
        stage = await self.make_stage(enums.StageType.ROUND_ROBIN, teams=self.team_ids[:2])
        async with self.Session() as s:
            encounters = await stage_service.generate_encounters(s, stage.id, notify=False)
        async with self.Session() as s:
            encounter = await s.get_one(Encounter, encounters[0].id)
            seats = await active_teams(s, encounter.id)
            await apply_result(
                s,
                encounter,
                source=enums.EncounterResultSource.ADMIN,
                totals={seats[0].id: 2.0, seats[1].id: 0.0},
                placements={seats[0].id: 1, seats[1].id: 2},
                action=enums.EncounterResultAuditAction.CONFIRM,
                audit_source="admin",
                actor_user_id=None,
                reason="test",
            )
            await s.commit()
        async with self.Session() as s:
            flat = await standings_service.load_stage_encounters(s, stage.id)
        self.assertEqual(1, len(flat))
        self.assertTrue(flat[0].completed)
        self.assertEqual(seats[0].team_id, flat[0].winner())
        self.assertEqual(2, len(flat[0].seats))

    async def test_a_tournament_recalculation_writes_the_table(self) -> None:
        stage = await self.make_stage(enums.StageType.ROUND_ROBIN, teams=self.team_ids[:2])
        async with self.Session() as s:
            encounters = await stage_service.generate_encounters(s, stage.id, notify=False)
            encounter = await s.get_one(Encounter, encounters[0].id)
            seats = await active_teams(s, encounter.id)
            await apply_result(
                s,
                encounter,
                source=enums.EncounterResultSource.ADMIN,
                totals={seats[0].id: 2.0, seats[1].id: 0.0},
                placements={seats[0].id: 1, seats[1].id: 2},
                action=enums.EncounterResultAuditAction.CONFIRM,
                audit_source="admin",
                actor_user_id=None,
                reason="test",
            )
            await s.commit()
        async with self.Session() as s:
            standings = await standings_service.recalculate_for_tournament(s, self.tournament_id)
        by_team = {standing.team_id: standing for standing in standings}
        self.assertEqual(1, by_team[seats[0].team_id].position)
        self.assertEqual(1, by_team[seats[0].team_id].win)
        self.assertEqual(1, by_team[seats[1].team_id].lose)


class ScrimClaimTests(StageLayerCase):
    """``claim_side`` fills slot 2 through ``place_team``.

    The real entry point, not the writer under it: what this guards is
    ``_free_side``'s new definition (slot 2 has no LIVE participation), the
    reserved slot-2 row ``create_room`` leaves behind, and the ordering that
    makes winning the conditional ``captain_id`` update the thing that
    authorizes the seat.

    ``create_room`` itself cannot run here: it provisions the room's pick-ban
    pool, and ``src.services.encounter.pick_ban_session`` does not import yet
    (Task 8). The rows it writes are built directly instead, in exactly the
    shape it writes them.
    """

    async def asyncSetUp(self) -> None:
        await super().asyncSetUp()
        self.auth_user_ids: list[int] = []

    async def asyncTearDown(self) -> None:
        async with self.Session() as s:
            await s.execute(sa.delete(AuthUser).where(AuthUser.id.in_(self.auth_user_ids or [0])))
            await s.commit()
        await super().asyncTearDown()

    async def _auth_user(self, tag: str) -> int:
        async with self.Session() as s:
            user = AuthUser(
                email=f"{tag}-{self.tag}@example.test",
                username=f"{tag}-{self.tag}",
                is_active=True,
            )
            s.add(user)
            await s.commit()
            self.auth_user_ids.append(user.id)
            return user.id

    def _viewer(self, auth_user_id: int, tag: str) -> SimpleNamespace:
        return SimpleNamespace(
            id=auth_user_id,
            username=f"{tag}-{self.tag}",
            email=f"{tag}-{self.tag}@example.test",
            is_superuser=False,
            get_workspace_ids=lambda: {self.workspace_id},
            has_workspace_permission=lambda *_a, **_k: False,
        )

    async def _room(self) -> tuple[str, int]:
        """A provisioned room: slot 1 seated, slot 2 reserved and retired."""
        creator = await self._auth_user("creator")
        async with self.Session() as s:
            rule = ScoringRule(
                workspace_id=self.workspace_id,
                preset="wins",
                game_formula="win",
                end_formula="games >= best_of or max_wins * 2 > best_of",
            )
            s.add(rule)
            await s.flush()
            stage = Stage(
                tournament_id=self.tournament_id,
                scoring_rule_id=rule.id,
                name="room",
                stage_type=enums.StageType.SINGLE_ELIMINATION,
                max_rounds=1,
                order=1,
                is_published=True,
            )
            s.add(stage)
            await s.flush()
            encounter = Encounter(
                workspace_id=self.workspace_id,
                discipline="overwatch",
                tournament_id=self.tournament_id,
                scoring_rule_id=rule.id,
                name="room",
                slot_count=2,
                best_of=3,
                status=enums.EncounterStatus.OPEN,
            )
            s.add(encounter)
            await s.flush()
            s.add(
                BracketEncounter(
                    encounter_id=encounter.id,
                    tournament_id=self.tournament_id,
                    stage_id=stage.id,
                    round=1,
                )
            )
            await place_team(s, encounter, slot=1, team_id=self.team_ids[0], name="A", seed=None, members=())
            await place_team(s, encounter, slot=2, team_id=self.team_ids[1], name="B", seed=None, members=())
            await vacate_slot(s, encounter, slot=2)
            room = ScrimRoom(
                token=f"tok-{self.tag}",
                label="room",
                workspace_id=self.workspace_id,
                tournament_id=self.tournament_id,
                stage_id=stage.id,
                encounter_id=encounter.id,
                created_by_auth_user_id=creator,
            )
            s.add(room)
            await s.commit()
            return room.token, encounter.id

    async def test_the_claim_seats_slot_two(self) -> None:
        token, encounter_id = await self._room()
        claimant = self._viewer(await self._auth_user("claimant"), "claimant")

        async with self.Session() as s:
            room = await scrim_service._load_room(s, token)
            self.assertEqual("away", _free_side(room.encounter))

        async with self.Session() as s:
            payload = await scrim_service.claim_side(s, claimant, token)

        self.assertEqual("away", payload["viewer_side"])
        self.assertTrue(payload["away_team"]["captain_claimed"])
        async with self.Session() as s:
            seats = await active_teams(s, encounter_id)
            rows = (
                (await s.execute(sa.select(EncounterTeam).where(EncounterTeam.encounter_id == encounter_id)))
                .scalars()
                .all()
            )
        self.assertEqual([1, 2], [seat.slot for seat in seats])
        self.assertEqual([self.team_ids[0], self.team_ids[1]], [seat.team_id for seat in seats])
        # Append-only: the reservation stays on record beside the live seat.
        self.assertEqual(3, len(rows))

    async def test_a_second_claimant_is_refused(self) -> None:
        token, _encounter_id = await self._room()
        first = self._viewer(await self._auth_user("first"), "first")
        second = self._viewer(await self._auth_user("second"), "second")

        async with self.Session() as s:
            await scrim_service.claim_side(s, first, token)
        with self.assertRaises(BaseAPIException) as ctx:
            async with self.Session() as s:
                await scrim_service.claim_side(s, second, token)
        self.assertEqual(409, ctx.exception.status_code)

    async def test_the_holder_claiming_again_is_idempotent(self) -> None:
        token, encounter_id = await self._room()
        claimant = self._viewer(await self._auth_user("again"), "again")

        async with self.Session() as s:
            await scrim_service.claim_side(s, claimant, token)
        async with self.Session() as s:
            payload = await scrim_service.claim_side(s, claimant, token)

        self.assertEqual("away", payload["viewer_side"])
        async with self.Session() as s:
            seats = await active_teams(s, encounter_id)
        self.assertEqual(2, len(seats), "a repeat claim must not write a second seat")


class ChallongeRoundTripTests(StageLayerCase):
    """Import and export: Challonge's participants 1 and 2 are slots 1 and 2."""

    def _match(self, **overrides) -> SimpleNamespace:
        fields = {
            "id": 9001,
            "round": 1,
            "state": "complete",
            "scores_csv": "2-1",
            "player1_id": 1,
            "player2_id": 2,
            "group_id": None,
            "player1_prereq_match_id": None,
            "player2_prereq_match_id": None,
            "player1_is_prereq_match_loser": False,
            "player2_is_prereq_match_loser": False,
        }
        return SimpleNamespace(**{**fields, **overrides})

    async def _import(self, match: SimpleNamespace, *, stage: Stage):
        """One match through ``_upsert_encounter_from_challonge``, for real."""
        source = challonge_sync._ImportSource(challonge_id=5, source_id=None, source_type="stage", stage=stage)
        match_lookup = challonge_sync._MatchLookup(
            by_source_key={}, by_challonge_id={}, mapped_keys=set(), unlinked_by_slot={}
        )
        async with self.Session() as s:
            tournament = await s.get_one(Tournament, self.tournament_id)
            teams_by_id = {
                team.id: team for team in (await s.execute(sa.select(Team).where(Team.id.in_(self.team_ids)))).scalars()
            }
            team_lookup = challonge_sync._TeamLookup(
                by_source_key={},
                by_key={(None, 1): self.team_ids[0], (None, 2): self.team_ids[1]},
                teams_by_id=teams_by_id,
            )
            with (
                patch.object(
                    challonge_sync.structure_service,
                    "_resolve_stage_refs_for_match",
                    AsyncMock(return_value=SimpleNamespace(stage_id=stage.id, stage_item_id=None)),
                ),
                patch.object(challonge_sync, "after_encounter_teams_changed", AsyncMock()),
            ):
                result = await challonge_sync.sync_service._upsert_encounter_from_challonge(
                    s,
                    tournament,
                    source,
                    match,
                    match_lookup=match_lookup,
                    team_lookup=team_lookup,
                )
            await s.commit()
            return result, result.encounter.id

    async def test_an_imported_match_seats_slots_one_and_two_and_stands_as_import(self) -> None:
        stage = await self.make_stage(enums.StageType.SINGLE_ELIMINATION)
        result, encounter_id = await self._import(self._match(), stage=stage)

        self.assertEqual("created", result.action)
        self.assertTrue(result.newly_completed)
        async with self.Session() as s:
            row = await s.get_one(Encounter, encounter_id)
            seats = await active_teams(s, encounter_id)
            position = await s.get(BracketEncounter, encounter_id)
        self.assertEqual("import", row.result_source)
        self.assertEqual(enums.EncounterResultStatus.CONFIRMED, row.result_status)
        self.assertEqual(enums.EncounterStatus.COMPLETED, row.status)
        self.assertEqual(stage.scoring_rule_id, row.scoring_rule_id)
        self.assertEqual(self.workspace_id, row.workspace_id)
        self.assertEqual("overwatch", row.discipline)
        self.assertEqual(2, row.slot_count)
        self.assertIsNotNone(position)
        self.assertEqual(1, position.round)
        # player1 -> slot 1, player2 -> slot 2.
        self.assertEqual([self.team_ids[0], self.team_ids[1]], [seat.team_id for seat in seats])
        self.assertEqual([2.0, 1.0], [seat.score for seat in seats])
        self.assertEqual([1, 2], [seat.placement for seat in seats])

    async def test_an_open_match_leaves_the_running_tally_without_a_standing(self) -> None:
        stage = await self.make_stage(enums.StageType.SINGLE_ELIMINATION)
        _created, encounter_id = await self._import(self._match(state="open", scores_csv="1-0"), stage=stage)

        async with self.Session() as s:
            row = await s.get_one(Encounter, encounter_id)
        self.assertIsNone(row.result_source)
        self.assertNotEqual(enums.EncounterStatus.COMPLETED, row.status)

    async def test_a_locally_confirmed_result_is_not_converted_to_an_import(self) -> None:
        """A sync may not take over a decision somebody made here (D57)."""
        stage = await self.make_stage(enums.StageType.ROUND_ROBIN, teams=self.team_ids[:2])
        async with self.Session() as s:
            encounters = await stage_service.generate_encounters(s, stage.id, notify=False)
            encounter = await s.get_one(Encounter, encounters[0].id)
            seats = await active_teams(s, encounter.id)
            await apply_result(
                s,
                encounter,
                source=enums.EncounterResultSource.ADMIN,
                totals={seats[0].id: 2.0, seats[1].id: 0.0},
                placements={seats[0].id: 1, seats[1].id: 2},
                action=enums.EncounterResultAuditAction.CONFIRM,
                audit_source="admin",
                actor_user_id=None,
                reason="admin call",
            )
            await s.commit()
            encounter_id = encounter.id
            version = encounter.result_version

        source = challonge_sync._ImportSource(challonge_id=5, source_id=None, source_type="stage", stage=stage)
        match_lookup = challonge_sync._MatchLookup(
            by_source_key={}, by_challonge_id={}, mapped_keys=set(), unlinked_by_slot={}
        )
        async with self.Session() as s:
            match_lookup.by_challonge_id[9001] = await s.get_one(Encounter, encounter_id)
            with patch.object(challonge_sync, "advance_and_announce", AsyncMock()):
                await challonge_sync.sync_service._advance_completed_challonge_matches(
                    s, [(source, self._match())], match_lookup=match_lookup
                )
            await s.commit()

        async with self.Session() as s:
            row = await s.get_one(Encounter, encounter_id)
        self.assertEqual("admin", row.result_source)
        self.assertEqual(version, row.result_version, "no second write, no spurious IMPORT audit row")

    async def test_the_export_pushes_the_two_seats_in_slot_order(self) -> None:
        stage = await self.make_stage(enums.StageType.SINGLE_ELIMINATION)
        _result, encounter_id = await self._import(self._match(), stage=stage)
        pushed: dict = {}

        async def _update_match(tournament_id, match_id, *, scores_csv, winner_id):
            pushed.update(match_id=match_id, scores_csv=scores_csv, winner_id=winner_id)

        source = challonge_sync._ImportSource(challonge_id=5, source_id=None, source_type="stage", stage=stage)
        async with self.Session() as s:
            tournament = await s.get_one(Tournament, self.tournament_id)
            encounter = await s.get_one(Encounter, encounter_id)
            with (
                patch.object(
                    challonge_sync.sync_service, "_resolve_export_target", AsyncMock(return_value=(source, 9001))
                ),
                patch.object(challonge_sync.sync_service, "_resolve_winner_challonge_id", AsyncMock(return_value=1)),
                patch.object(challonge_sync.challonge_client, "update_match", AsyncMock(side_effect=_update_match)),
                patch.object(challonge_sync.sync_log_service, "_log_sync", AsyncMock()),
            ):
                self.assertTrue(await challonge_sync.sync_service.push_single_result(s, tournament, encounter))

        # Slot 1's score first: that IS participant 1's.
        self.assertEqual("2-1", pushed["scores_csv"])
        self.assertEqual(1, pushed["winner_id"])
        self.assertEqual(9001, pushed["match_id"])

    async def test_a_drawn_scoreline_exports_as_a_tie(self) -> None:
        stage = await self.make_stage(enums.StageType.SINGLE_ELIMINATION)
        _result, encounter_id = await self._import(self._match(scores_csv="1-1"), stage=stage)
        pushed: dict = {}

        async def _update_match(tournament_id, match_id, *, scores_csv, winner_id):
            pushed.update(scores_csv=scores_csv, winner_id=winner_id)

        source = challonge_sync._ImportSource(challonge_id=5, source_id=None, source_type="stage", stage=stage)
        async with self.Session() as s:
            tournament = await s.get_one(Tournament, self.tournament_id)
            encounter = await s.get_one(Encounter, encounter_id)
            with (
                patch.object(
                    challonge_sync.sync_service, "_resolve_export_target", AsyncMock(return_value=(source, 9001))
                ),
                patch.object(challonge_sync.challonge_client, "update_match", AsyncMock(side_effect=_update_match)),
                patch.object(challonge_sync.sync_log_service, "_log_sync", AsyncMock()),
            ):
                await challonge_sync.sync_service.push_single_result(s, tournament, encounter)

        self.assertEqual("tie", pushed["winner_id"])
        self.assertEqual("1-1", pushed["scores_csv"])

    async def test_reseating_retires_the_old_occupant(self) -> None:
        """Challonge corrected participant 2: the seat changes hands (D55)."""
        stage = await self.make_stage(enums.StageType.SINGLE_ELIMINATION)
        _result, encounter_id = await self._import(self._match(state="open"), stage=stage)
        names = {team_id: f"T{team_id}" for team_id in self.team_ids}

        async with self.Session() as s:
            encounter = await s.get_one(Encounter, encounter_id)
            changed = await challonge_sync._reseat(s, encounter, [self.team_ids[0], self.team_ids[2]], names)
            await s.commit()
        self.assertTrue(changed)
        async with self.Session() as s:
            seats = await active_teams(s, encounter_id)
            rows = (
                (await s.execute(sa.select(EncounterTeam).where(EncounterTeam.encounter_id == encounter_id)))
                .scalars()
                .all()
            )
        self.assertEqual([self.team_ids[0], self.team_ids[2]], [seat.team_id for seat in seats])
        self.assertEqual(3, len(rows), "the replaced occupant stays on record")

    async def test_a_drawn_scoreline_shares_first_place(self) -> None:
        self.assertEqual({1: 1, 2: 1}, challonge_sync._places({1: 1.0, 2: 1.0}))
        self.assertEqual({1: 1, 2: 2}, challonge_sync._places({1: 2.0, 2: 1.0}))
