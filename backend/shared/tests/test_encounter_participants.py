"""The only writer of an encounter's seats (D55). Needs the test Postgres.

A participation is append-only: replacing an occupant writes a new row and
retires the old one, which is what keeps "who played this game" answerable
after a bracket correction. These cases pin that against the real partial
unique indexes -- an in-memory double cannot fail the way the database does.

The last class covers the encounter readers that were ported along with the
writer: they read the bracket position and the participations out of the two
tables those columns moved to, and only the database can say the joins are
right.
"""

from __future__ import annotations

import sqlalchemy as sa

from shared.core import enums
from shared.core.errors import BaseAPIException
from shared.models.encounter import (
    Encounter,
    EncounterGame,
    EncounterGameTeam,
    EncounterTeam,
    EncounterTeamMember,
    EncounterTeamMemberRole,
)
from shared.models.tournament.bracket_encounter import BracketEncounter
from shared.models.tournament.challonge import ChallongeMatchMapping, ChallongeSource
from shared.models.tournament.stage import Stage, StageItem
from shared.repository import EncounterRepository
from shared.services.encounter import participants
from shared.tests.encounter_writer_case import EncounterWriterCase


def _member(member_id: int, name: str, *, substitute: bool = False) -> participants.MemberSnapshot:
    return participants.MemberSnapshot(
        workspace_member_id=member_id,
        display_name=name,
        rank=2500,
        is_substitute=substitute,
        roles=(("player_role", "tank"),),
    )


class ParticipationWriterCase(EncounterWriterCase):
    async def place(self, session, slot: int, team_key: str, *member_keys: str) -> EncounterTeam:
        encounter = await self.encounter(session)
        return await participants.place_team(
            session,
            encounter,
            slot=slot,
            team_id=self.ids[team_key],
            name=team_key.upper(),
            seed=slot,
            members=[_member(self.ids[key], key) for key in member_keys],
        )

    async def add_game(self, session, position: int, state: enums.EncounterGameState) -> EncounterGame:
        """One game of the seeded encounter, joined by every active seat."""
        game = EncounterGame(
            encounter_id=self.ids["e"],
            position=position,
            state=state,
            result_source=(
                enums.EncounterGameResultSource.ADMIN if state == enums.EncounterGameState.CONFIRMED else None
            ),
            confirmed_at=sa.func.now() if state == enums.EncounterGameState.CONFIRMED else None,
        )
        session.add(game)
        await session.flush()
        for seat in await participants.active_teams(session, self.ids["e"]):
            session.add(
                EncounterGameTeam(game_id=game.id, encounter_id=self.ids["e"], encounter_team_id=seat.id, score=1)
            )
        await session.flush()
        return game


class PlaceTeamTests(ParticipationWriterCase):
    async def test_a_slot_outside_the_card_is_refused(self) -> None:
        async with self.Session() as s:
            for slot in (0, self.slot_count + 1):
                with self.assertRaises(BaseAPIException):
                    await self.place(s, slot, "team0", "m0")

    async def test_an_occupied_slot_is_refused(self) -> None:
        async with self.Session() as s:
            await self.place(s, 1, "team0", "m0")
            with self.assertRaises(BaseAPIException):
                await self.place(s, 1, "team1", "m1")

    async def test_the_roster_is_snapshotted_with_its_roles(self) -> None:
        async with self.Session() as s:
            participation = await self.place(s, 1, "team0", "m0")
            await s.commit()

        async with self.Session() as s:
            member = (
                await s.execute(
                    sa.select(EncounterTeamMember).where(EncounterTeamMember.encounter_team_id == participation.id)
                )
            ).scalar_one()
            self.assertEqual(self.ids["m0"], member.workspace_member_id)
            self.assertEqual("m0", member.display_name_snapshot)
            self.assertEqual(2500, member.rank)
            self.assertTrue(member.active)
            self.assertFalse(member.is_substitute)
            roles = (
                await s.execute(
                    sa.select(EncounterTeamMemberRole.dimension, EncounterTeamMemberRole.role).where(
                        EncounterTeamMemberRole.team_member_id == member.id
                    )
                )
            ).all()
            self.assertEqual([("player_role", "tank")], roles)

    async def test_active_teams_reads_the_live_seats_in_slot_order(self) -> None:
        async with self.Session() as s:
            await self.place(s, 2, "team1", "m1")
            await self.place(s, 1, "team0", "m0")
            await s.commit()
        async with self.Session() as s:
            seats = await participants.active_teams(s, self.ids["e"])
            self.assertEqual([1, 2], [seat.slot for seat in seats])


class ReplaceOccupantTests(ParticipationWriterCase):
    async def test_the_retired_participation_keeps_the_games_it_played(self) -> None:
        async with self.Session() as s:
            old = await self.place(s, 1, "team0", "m0")
            await self.place(s, 2, "team1", "m1")
            game = await self.add_game(s, 1, enums.EncounterGameState.CONFIRMED)
            await s.commit()

        async with self.Session() as s:
            encounter = await self.encounter(s)
            vacated = await participants.vacate_slot(s, encounter, slot=1)
            self.assertEqual(old.id, vacated.id)
            new = await self.place(s, 1, "team2", "m2")
            await s.commit()
            self.assertNotEqual(old.id, new.id)

        async with self.Session() as s:
            rows = (
                await s.execute(
                    sa.select(EncounterTeam.id, EncounterTeam.active)
                    .where(EncounterTeam.encounter_id == self.ids["e"], EncounterTeam.slot == 1)
                    .order_by(EncounterTeam.id)
                )
            ).all()
            self.assertEqual([(old.id, False), (new.id, True)], rows)
            # The game's row still names the participation that played it.
            played_by = (
                (
                    await s.execute(
                        sa.select(EncounterGameTeam.encounter_team_id).where(
                            EncounterGameTeam.game_id == game.id,
                            EncounterGameTeam.encounter_team_id.in_([old.id, new.id]),
                        )
                    )
                )
                .scalars()
                .all()
            )
            self.assertEqual([old.id], played_by)
            self.assertEqual(
                enums.EncounterGameState.CONFIRMED,
                await s.scalar(sa.select(EncounterGame.state).where(EncounterGame.id == game.id)),
            )
            # The retired roster goes inactive with its seat, so the replacement
            # may seat the same player again.
            self.assertEqual(
                [False],
                (
                    await s.execute(
                        sa.select(EncounterTeamMember.active).where(EncounterTeamMember.encounter_team_id == old.id)
                    )
                )
                .scalars()
                .all(),
            )

    async def test_the_same_team_may_be_seated_again_after_it_was_vacated(self) -> None:
        """A bracket correction that re-places the team it just removed must not
        trip ``uq_team_active_source`` or ``uq_team_member_active_member``."""
        async with self.Session() as s:
            await self.place(s, 1, "team0", "m0")
            await s.commit()
        async with self.Session() as s:
            encounter = await self.encounter(s)
            await participants.vacate_slot(s, encounter, slot=1)
            again = await self.place(s, 1, "team0", "m0")
            await s.commit()
            self.assertTrue(again.active)


class VacateSlotTests(ParticipationWriterCase):
    async def test_planned_games_are_cancelled_and_confirmed_ones_are_kept(self) -> None:
        async with self.Session() as s:
            await self.place(s, 1, "team0", "m0")
            await self.place(s, 2, "team1", "m1")
            confirmed = await self.add_game(s, 1, enums.EncounterGameState.CONFIRMED)
            planned = await self.add_game(s, 2, enums.EncounterGameState.PLANNED)
            awaiting = await self.add_game(s, 3, enums.EncounterGameState.AWAITING_RESULT)
            await s.commit()

        async with self.Session() as s:
            encounter = await self.encounter(s)
            await participants.vacate_slot(s, encounter, slot=1)
            await s.commit()

        async with self.Session() as s:
            states = dict(
                (
                    await s.execute(
                        sa.select(EncounterGame.id, EncounterGame.state).where(
                            EncounterGame.encounter_id == self.ids["e"]
                        )
                    )
                ).all()
            )
            self.assertEqual(enums.EncounterGameState.CONFIRMED, states[confirmed.id])
            self.assertEqual(enums.EncounterGameState.CANCELLED, states[planned.id])
            self.assertEqual(enums.EncounterGameState.CANCELLED, states[awaiting.id])

    async def test_an_empty_slot_vacates_to_nothing(self) -> None:
        async with self.Session() as s:
            encounter = await self.encounter(s)
            self.assertIsNone(await participants.vacate_slot(s, encounter, slot=1))


class AddSubstituteTests(ParticipationWriterCase):
    async def test_a_substitute_joins_the_live_roster(self) -> None:
        async with self.Session() as s:
            participation = await self.place(s, 1, "team0", "m0")
            row = await participants.add_substitute(s, participation, _member(self.ids["m3"], "m3", substitute=True))
            await s.commit()
            self.assertTrue(row.is_substitute)
            self.assertTrue(row.active)

        async with self.Session() as s:
            names = (
                (
                    await s.execute(
                        sa.select(EncounterTeamMember.display_name_snapshot)
                        .where(EncounterTeamMember.encounter_team_id == participation.id)
                        .order_by(EncounterTeamMember.id)
                    )
                )
                .scalars()
                .all()
            )
            self.assertEqual(["m0", "m3"], names)


class EncounterReaderTests(ParticipationWriterCase):
    """The readers that used to live on the encounter's own columns."""

    encounters = EncounterRepository()

    async def _position(self) -> dict[str, int]:
        """Put the seeded encounter in a bracket and on a Challonge source."""
        async with self.Session() as s:
            stage = Stage(
                tournament_id=self.ids["t"],
                name="S",
                stage_type=enums.StageType.SINGLE_ELIMINATION,
                order=1,
                scoring_rule_id=self.ids["rule"],
            )
            s.add(stage)
            await s.flush()
            item = StageItem(stage_id=stage.id, name="A", type=enums.StageItemType.SINGLE_BRACKET, order=1)
            source = ChallongeSource(tournament_id=self.ids["t"], challonge_tournament_id=777)
            s.add_all([item, source])
            await s.flush()
            s.add_all(
                [
                    BracketEncounter(
                        encounter_id=self.ids["e"],
                        tournament_id=self.ids["t"],
                        stage_id=stage.id,
                        stage_item_id=item.id,
                        round=1,
                    ),
                    ChallongeMatchMapping(source_id=source.id, challonge_match_id=4242, encounter_id=self.ids["e"]),
                ]
            )
            await s.commit()
            return {"stage": stage.id, "item": item.id}

    async def test_the_bracket_readers_find_the_positioned_encounter(self) -> None:
        await self._position()
        async with self.Session() as s:
            self.assertEqual(
                [self.ids["e"]],
                [e.id for e in await self.encounters.list_by_tournament(s, self.ids["t"])],
            )

    async def test_deleting_a_stage_items_encounters_leaves_the_rest(self) -> None:
        where = await self._position()
        async with self.Session() as s:
            loose = Encounter(
                workspace_id=self.ids["ws"],
                discipline="overwatch",
                tournament_id=self.ids["t"],
                scoring_rule_id=self.ids["rule"],
                name="no bracket position",
                slot_count=2,
            )
            s.add(loose)
            await s.commit()
            # Bracket order first, the positionless encounter last.
            self.assertEqual(
                [self.ids["e"], loose.id],
                [e.id for e in await self.encounters.list_by_tournament(s, self.ids["t"])],
            )

        async with self.Session() as s:
            await self.encounters.delete_for_stage_item(s, where["item"])
            await s.commit()
        async with self.Session() as s:
            self.assertEqual([loose.id], [e.id for e in await self.encounters.list_by_tournament(s, self.ids["t"])])
