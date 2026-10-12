"""What confirming an encounter owes, and when a result may not be written at all.

Every path that confirms an encounter advances the bracket and queues the
standings (``settle_confirmed``); a result with an empty slot is refused (D64);
a tied elimination result is refused instead of stalling the bracket (D42); an
admin-made encounter seats nobody for an empty slot (D55). Real Postgres, like
the other result-flow suites: the seats, links and constraints are the point.
"""

from __future__ import annotations

from unittest.mock import ANY, AsyncMock, patch

import sqlalchemy as sa

from shared.core import enums
from shared.core.errors import BaseAPIException
from shared.models.encounter import Encounter, EncounterGame
from shared.models.tournament.encounter_link import EncounterLink
from shared.models.tournament.stage import Stage
from shared.services.encounter.participants import active_teams
from src import schemas
from src.services.admin.encounter import encounter_service as admin_encounter_service
from src.services.encounter.captain import ReportResultIn, captain_service
from src.services.encounter.games import GameResultIn, encounter_game_service
from src.services.encounter.map_report import ClaimResultIn, map_report_service
from tests._encounter_layer import EncounterLayerCase


def _codes(exc: BaseAPIException) -> list[str]:
    detail = exc.detail
    return [detail] if isinstance(detail, str) else [getattr(item, "code", None) or item.get("code") for item in detail]


class SettlementCase(EncounterLayerCase):
    """A published single-elimination stage: the captains may report in it."""

    async def asyncSetUp(self) -> None:
        await super().asyncSetUp()
        await self.set_stage(is_published=True)

    async def set_stage(self, **values) -> None:
        async with self.Session() as s:
            await s.execute(sa.update(Stage).where(Stage.id == self.stage_id).values(**values))
            await s.commit()

    async def link(self, source_id: int, target_id: int) -> None:
        async with self.Session() as s:
            s.add(
                EncounterLink(
                    tournament_id=self.tournament_id,
                    source_encounter_id=source_id,
                    source_position=1,
                    target_encounter_id=target_id,
                    target_slot=1,
                )
            )
            await s.commit()

    async def open_game(self, encounter_id: int, position: int) -> EncounterGame:
        async with self.Session() as s:
            encounter = await s.get_one(Encounter, encounter_id)
            game = await encounter_game_service.open_game(s, encounter, position=position)
            await s.commit()
            return game


class ClaimSettlementTests(SettlementCase):
    """R-C1: a series the games finish advances like one a captain reported."""

    async def test_claims_that_finish_the_series_seat_the_next_round_and_queue_the_standings(self) -> None:
        source = await self.encounter(0, 1)
        final = await self.encounter(None, 2)
        await self.link(source, final)
        async with self.Session() as s:
            winner, loser = await active_teams(s, source)

        with (
            patch("src.services.encounter.settle.enqueue_tournament_recalculation", AsyncMock()) as recalc,
            patch("src.services.encounter.map_report.push_confirmed_to_challonge", AsyncMock()) as push,
        ):
            for position in (1, 2):
                game = await self.open_game(source, position)
                for seat in (winner, loser):
                    async with self.Session() as s:
                        await map_report_service.submit_game_claim(
                            s,
                            game.id,
                            claimant_team_id=seat.id,
                            reporter_user_id=None,
                            results=[
                                ClaimResultIn(encounter_team_id=winner.id, score=3),
                                ClaimResultIn(encounter_team_id=loser.id, score=1),
                            ],
                            basis_version=0,
                        )
                if position == 1:
                    recalc.assert_not_awaited()
                    push.assert_not_awaited()

        async with self.Session() as s:
            self.assertEqual(enums.EncounterResultStatus.CONFIRMED, (await s.get_one(Encounter, source)).result_status)
            seated = await active_teams(s, final)
            self.assertEqual([(1, winner.team_id), (2, self.teams[2])], [(seat.slot, seat.team_id) for seat in seated])
        recalc.assert_awaited_once_with(ANY, self.tournament_id)
        push.assert_awaited_once_with(ANY, source)


class UnfilledSlotTests(SettlementCase):
    """R-C2: one seated captain cannot decide an encounter alone."""

    async def asyncSetUp(self) -> None:
        await super().asyncSetUp()
        self.encounter_id = await self.encounter(0, None)
        self.game = await self.open_game(self.encounter_id, 1)
        async with self.Session() as s:
            (self.seat,) = await active_teams(s, self.encounter_id)

    async def test_a_series_report_is_refused(self) -> None:
        with self.assertRaises(BaseAPIException) as caught:
            async with self.Session() as s:
                await captain_service.submit_team_report(
                    s,
                    self.encounter_id,
                    encounter_team_id=self.seat.id,
                    reporter_user_id=None,
                    games_played=2,
                    results=[ReportResultIn(encounter_team_id=self.seat.id, score=2.0, placement=1, wins=2)],
                    basis_version=0,
                )
        self.assertEqual((409, ["seats_incomplete"]), (caught.exception.status_code, _codes(caught.exception)))
        async with self.Session() as s:
            self.assertEqual([], await captain_service.get_encounter_reports(s, self.encounter_id))

    async def test_a_game_claim_is_refused(self) -> None:
        with self.assertRaises(BaseAPIException) as caught:
            async with self.Session() as s:
                await map_report_service.submit_game_claim(
                    s,
                    self.game.id,
                    claimant_team_id=self.seat.id,
                    reporter_user_id=None,
                    results=[ClaimResultIn(encounter_team_id=self.seat.id, score=3)],
                    basis_version=0,
                )
        self.assertEqual((409, ["seats_incomplete"]), (caught.exception.status_code, _codes(caught.exception)))

    async def test_an_accepted_game_result_is_refused(self) -> None:
        with self.assertRaises(BaseAPIException) as caught:
            async with self.Session() as s:
                encounter = await s.get_one(Encounter, self.encounter_id)
                game = await s.get_one(EncounterGame, self.game.id)
                await encounter_game_service.record_result(
                    s,
                    encounter,
                    game,
                    results=[GameResultIn(encounter_team_id=self.seat.id, score=3)],
                    source=enums.EncounterGameResultSource.ADMIN,
                    actor_user_id=None,
                )
        self.assertEqual((409, ["seats_incomplete"]), (caught.exception.status_code, _codes(caught.exception)))


class BracketTieTests(SettlementCase):
    """R-I5: a draw is a result in a league and a stuck bracket in an elimination."""

    async def asyncSetUp(self) -> None:
        await super().asyncSetUp()
        self.encounter_id = await self.encounter(0, 1, best_of=2)
        async with self.Session() as s:
            self.seats = await active_teams(s, self.encounter_id)

    def level(self, wins: int = 1) -> list[ReportResultIn]:
        return [
            ReportResultIn(encounter_team_id=seat.id, score=float(wins), placement=1, wins=wins) for seat in self.seats
        ]

    async def status(self) -> enums.EncounterResultStatus:
        async with self.Session() as s:
            return (await s.get_one(Encounter, self.encounter_id)).result_status

    async def test_an_admin_cannot_confirm_a_tied_elimination_encounter(self) -> None:
        with self.assertRaises(BaseAPIException) as caught:
            async with self.Session() as s:
                await captain_service.set_encounter_result(
                    s, self.encounter_id, results=self.level(), reason="called it", actor_user_id=None
                )
        self.assertEqual((400, ["bracket_tie"]), (caught.exception.status_code, _codes(caught.exception)))
        self.assertEqual(enums.EncounterResultStatus.NONE, await self.status())

    async def test_captains_cannot_agree_on_a_tie_in_an_elimination_encounter(self) -> None:
        with self.assertRaises(BaseAPIException) as caught:
            for seat in self.seats:
                async with self.Session() as s:
                    await captain_service.submit_team_report(
                        s,
                        self.encounter_id,
                        encounter_team_id=seat.id,
                        reporter_user_id=None,
                        games_played=2,
                        closeness=5,
                        results=self.level(),
                        basis_version=(await s.get_one(Encounter, self.encounter_id)).result_version,
                    )
        self.assertEqual((400, ["bracket_tie"]), (caught.exception.status_code, _codes(caught.exception)))
        self.assertEqual(enums.EncounterResultStatus.PENDING_CONFIRMATION, await self.status())

    async def test_a_league_stage_takes_the_draw(self) -> None:
        await self.set_stage(stage_type=enums.StageType.ROUND_ROBIN)
        async with self.Session() as s:
            await captain_service.set_encounter_result(
                s, self.encounter_id, results=self.level(), reason="called it", actor_user_id=None
            )
        self.assertEqual(enums.EncounterResultStatus.CONFIRMED, await self.status())


class AdminCreateTests(SettlementCase):
    """R-I4: an empty slot is no participation (D55)."""

    async def test_an_empty_seat_stays_empty(self) -> None:
        async with self.Session() as s:
            created = await admin_encounter_service.create_encounter(
                s,
                schemas.EncounterCreate(
                    name="Final",
                    tournament_id=self.tournament_id,
                    stage_id=self.stage_id,
                    stage_item_id=self.item_id,
                    round=2,
                    teams=[
                        schemas.EncounterSeatInput(slot=1, team_id=self.teams[0]),
                        schemas.EncounterSeatInput(slot=2, team_id=None),
                    ],
                ),
            )
            encounter_id = created.id
        async with self.Session() as s:
            seated = await active_teams(s, encounter_id)
        self.assertEqual([(1, self.teams[0])], [(seat.slot, seat.team_id) for seat in seated])
