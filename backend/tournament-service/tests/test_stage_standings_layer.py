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
from unittest import IsolatedAsyncioTestCase

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import async_sessionmaker

from shared.core import enums
from shared.models.encounter import Encounter, EncounterTeam, ScoringRule
from shared.models.identity.user import User
from shared.models.tenancy.workspace import Workspace
from shared.models.tournament.bracket_encounter import BracketEncounter
from shared.models.tournament.stage import Stage, StageItem, StageItemInput
from shared.models.tournament.team import Team
from shared.models.tournament.tournament import Tournament
from shared.services.encounter.participants import active_teams, place_team
from shared.services.encounter.result import apply_result
from shared.testing import create_test_async_engine
from shared.testing.db import ensure_test_postgres
from src import schemas
from src.services.admin.stage import rule_values, stage_service
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
    """A room claim fills slot 2 through ``place_team``."""

    async def test_the_claim_seats_slot_two(self) -> None:
        from src.services.scrim.service import _free_side, _seat_at

        async with self.Session() as s:
            rule = ScoringRule(
                workspace_id=self.workspace_id,
                preset="wins",
                game_formula="win",
                end_formula="games >= best_of or max_wins * 2 > best_of",
            )
            s.add(rule)
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
            await place_team(
                s, encounter, slot=1, team_id=self.team_ids[0], name="A", seed=None, members=()
            )
            # The reservation: seated, then retired, exactly as ``create_room`` does.
            from shared.services.encounter.participants import vacate_slot

            await place_team(
                s, encounter, slot=2, team_id=self.team_ids[1], name="B", seed=None, members=()
            )
            await vacate_slot(s, encounter, slot=2)
            await s.commit()
            encounter_id = encounter.id

        async with self.Session() as s:
            loaded = await s.get_one(
                Encounter, encounter_id, options=[sa.orm.selectinload(Encounter.teams)]
            )
            self.assertEqual("away", _free_side(loaded))
            reserved = _seat_at(loaded, 2)
            self.assertIsNotNone(reserved)
            self.assertFalse(reserved.active)
            self.assertEqual(self.team_ids[1], reserved.team_id)

            # The claim itself: slot 2 is filled by the participation writer.
            await place_team(
                s, loaded, slot=2, team_id=reserved.team_id, name=reserved.name, seed=None, members=()
            )
            await s.commit()

        async with self.Session() as s:
            seats = await active_teams(s, encounter_id)
        self.assertEqual([1, 2], [seat.slot for seat in seats])
        self.assertEqual([self.team_ids[0], self.team_ids[1]], [seat.team_id for seat in seats])
        # The reservation stays on record beside the live seat (append-only).
        async with self.Session() as s:
            rows = (
                await s.execute(sa.select(EncounterTeam).where(EncounterTeam.encounter_id == encounter_id))
            ).scalars()
        self.assertEqual(3, len(list(rows)))


class ChallongeRoundTripTests(StageLayerCase):
    """Participants 1/2 map to slots 1/2 and an import stands as source ``import``."""

    async def test_an_imported_result_seats_both_slots_and_stands_as_import(self) -> None:
        from src.services.challonge.sync import _reseat, _write_import_result

        async with self.Session() as s:
            rule = ScoringRule(
                workspace_id=self.workspace_id,
                preset="wins",
                game_formula="win",
                end_formula="games >= best_of or max_wins * 2 > best_of",
            )
            s.add(rule)
            await s.flush()
            encounter = Encounter(
                workspace_id=self.workspace_id,
                discipline="overwatch",
                tournament_id=self.tournament_id,
                scoring_rule_id=rule.id,
                name="M",
                slot_count=2,
                status=enums.EncounterStatus.OPEN,
            )
            s.add(encounter)
            await s.flush()
            # player1 -> slot 1, player2 -> slot 2.
            changed = await _reseat(
                s, encounter, [self.team_ids[0], self.team_ids[1]], {self.team_ids[0]: "A", self.team_ids[1]: "B"}
            )
            self.assertTrue(changed)
            await _write_import_result(s, encounter, [2, 1])
            await s.commit()
            encounter_id = encounter.id

        async with self.Session() as s:
            row = await s.get_one(Encounter, encounter_id)
            seats = await active_teams(s, encounter_id)
        self.assertEqual("import", row.result_source)
        self.assertEqual(enums.EncounterResultStatus.CONFIRMED, row.result_status)
        self.assertEqual(enums.EncounterStatus.COMPLETED, row.status)
        self.assertEqual([self.team_ids[0], self.team_ids[1]], [seat.team_id for seat in seats])
        self.assertEqual([2.0, 1.0], [seat.score for seat in seats])
        self.assertEqual([1, 2], [seat.placement for seat in seats])

    async def test_a_drawn_scoreline_shares_first_place(self) -> None:
        from src.services.challonge.sync import _places

        self.assertEqual({1: 1, 2: 1}, _places({1: 1.0, 2: 1.0}))
        self.assertEqual({1: 1, 2: 2}, _places({1: 2.0, 2: 1.0}))

    async def test_reseating_retires_the_old_occupant(self) -> None:
        from src.services.challonge.sync import _reseat

        async with self.Session() as s:
            rule = ScoringRule(
                workspace_id=self.workspace_id,
                preset="wins",
                game_formula="win",
                end_formula="games >= best_of or max_wins * 2 > best_of",
            )
            s.add(rule)
            await s.flush()
            encounter = Encounter(
                workspace_id=self.workspace_id,
                discipline="overwatch",
                tournament_id=self.tournament_id,
                scoring_rule_id=rule.id,
                name="M",
                slot_count=2,
                status=enums.EncounterStatus.OPEN,
            )
            s.add(encounter)
            await s.flush()
            names = {team_id: f"T{team_id}" for team_id in self.team_ids}
            await _reseat(s, encounter, [self.team_ids[0], self.team_ids[1]], names)
            # Challonge corrected participant 2.
            changed = await _reseat(s, encounter, [self.team_ids[0], self.team_ids[2]], names)
            await s.commit()
            encounter_id = encounter.id
        self.assertTrue(changed)
        async with self.Session() as s:
            seats = await active_teams(s, encounter_id)
            all_rows = (
                await s.execute(sa.select(EncounterTeam).where(EncounterTeam.encounter_id == encounter_id))
            ).scalars()
        self.assertEqual([self.team_ids[0], self.team_ids[2]], [seat.team_id for seat in seats])
        self.assertEqual(3, len(list(all_rows)), "the replaced occupant stays on record")


def _unused() -> None:
    """Keep the imports the cases reach for through locals honest."""
    assert User is not None
