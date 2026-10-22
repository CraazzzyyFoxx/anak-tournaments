"""Playoff standings while the bracket is still running. Needs the test Postgres.

An eliminated team holds the best place it can still end on -- a beaten semi-finalist
is 3rd while the final is unplayed -- and a team still alive has none yet (0).
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from shared.core import enums
from shared.models.encounter import Encounter
from shared.models.tournament import Standing
from shared.services.encounter import participants
from src.domain.bracket import engine
from src.domain.bracket.types import AdvancementEdge, BracketSkeleton, Pairing
from src.services.bracket import advancement
from src.services.standings.service import standings_service
from tests.test_bracket_positions import BracketCase


class _PlayoffTableCase(BracketCase):
    async def persisted(self, skeleton: BracketSkeleton) -> list[int]:
        async with self.Session() as s:
            ids = [encounter.id for encounter in await self.build(s, skeleton)]
            await s.commit()
        return ids

    async def play(self, encounter_ids: Sequence[int]) -> set[int]:
        """Slot 1 wins each encounter and advances; returns the losers."""
        losers: set[int] = set()
        async with self.Session() as s:
            for encounter_id in encounter_ids:
                encounter = await s.get_one(Encounter, encounter_id)
                seats = await participants.active_teams(s, encounter_id)
                losers.update(seat.team_id for seat in seats if seat.slot != 1)
                await self.win(s, encounter, winner_slot=1)
                await advancement.advance_after_result(s, encounter)
            await s.commit()
        return losers

    async def table(self) -> dict[int, tuple[int, int]]:
        """``team -> (position, overall_position)`` after a recalculation."""
        async with self.Session() as s:
            await standings_service.recalculate_for_tournament(s, self.ids["t"])
            rows = await s.execute(
                sa.select(Standing.team_id, Standing.position, Standing.overall_position).where(
                    Standing.stage_id == self.ids["stage"]
                )
            )
            return {team_id: (position, overall) for team_id, position, overall in rows.all()}


def _round(skeleton: BracketSkeleton, ids: Sequence[int], round_number: int) -> list[int]:
    return [ids[pairing.local_id] for pairing in skeleton.pairings if pairing.round_number == round_number]


class SingleEliminationMidBracketTests(_PlayoffTableCase):
    async def test_a_beaten_semi_finalist_is_third_while_the_final_is_unplayed(self) -> None:
        skeleton = engine.generate_bracket(enums.StageType.SINGLE_ELIMINATION, self.team_ids)
        ids = await self.persisted(skeleton)
        semi_losers = await self.play(_round(skeleton, ids, 1))

        self.assertEqual(
            {team_id: (3, 3) if team_id in semi_losers else (0, 0) for team_id in self.team_ids},
            await self.table(),
        )

        (final_loser,) = await self.play(_round(skeleton, ids, 2))
        self.assertEqual(
            {
                team_id: (3, 3) if team_id in semi_losers else (2, 2) if team_id == final_loser else (1, 1)
                for team_id in self.team_ids
            },
            await self.table(),
        )


class SingleEliminationQuarterFinalTests(_PlayoffTableCase):
    team_count = 8

    async def test_quarter_final_losers_share_fifth_while_the_semis_are_unplayed(self) -> None:
        skeleton = engine.generate_bracket(enums.StageType.SINGLE_ELIMINATION, self.team_ids)
        ids = await self.persisted(skeleton)
        quarter_losers = await self.play(_round(skeleton, ids, 1))

        self.assertEqual(
            {team_id: (5, 5) if team_id in quarter_losers else (0, 0) for team_id in self.team_ids},
            await self.table(),
        )


class SingleEliminationThirdPlaceTests(_PlayoffTableCase):
    async def test_the_third_place_match_decides_third_and_fourth_not_the_title(self) -> None:
        # A Challonge "hold third place match" bracket: the semi losers meet in
        # a match that shares the final's round, wired to their LOSING places.
        plain = engine.generate_bracket(enums.StageType.SINGLE_ELIMINATION, self.team_ids)
        semis = [pairing for pairing in plain.pairings if pairing.round_number == 1]
        bronze = Pairing(team_ids=(None, None), round_number=2, local_id=len(plain.pairings))
        skeleton = BracketSkeleton(
            pairings=[*plain.pairings, bronze],
            total_rounds=plain.total_rounds,
            advancement_edges=[
                *plain.advancement_edges,
                *(
                    AdvancementEdge(
                        source_local_id=semi.local_id,
                        source_position=2,
                        target_local_id=bronze.local_id,
                        target_slot=slot,
                    )
                    for slot, semi in enumerate(semis, 1)
                ),
            ],
        )
        ids = await self.persisted(skeleton)
        (final_id,) = (ids[pairing.local_id] for pairing in plain.pairings if pairing.round_number == 2)
        semi_losers = await self.play(_round(plain, ids, 1))

        (fourth,) = await self.play([ids[bronze.local_id]])
        (third,) = semi_losers - {fourth}
        self.assertEqual(
            {team_id: {third: (3, 3), fourth: (4, 4)}.get(team_id, (0, 0)) for team_id in self.team_ids},
            await self.table(),
        )

        (second,) = await self.play([final_id])
        (first,) = set(self.team_ids) - semi_losers - {second}
        self.assertEqual(
            {first: (1, 1), second: (2, 2), third: (3, 3), fourth: (4, 4)},
            await self.table(),
        )


class DoubleEliminationMidBracketTests(_PlayoffTableCase):
    stage_type = enums.StageType.DOUBLE_ELIMINATION
    team_count = 8

    async def test_lower_seeds_knocked_out_first_are_seventh_while_the_upper_bracket_is_unplayed(self) -> None:
        upper, lower = self.team_ids[:4], self.team_ids[4:]
        skeleton = engine.generate_bracket(enums.StageType.DOUBLE_ELIMINATION, upper, lower_bracket_team_ids=lower)
        ids = await self.persisted(skeleton)
        knocked_out = await self.play(_round(skeleton, ids, -1))

        # The upper seeds have not played: no row yet, let alone a place.
        self.assertEqual(
            {team_id: (7, 7) if team_id in knocked_out else (0, 0) for team_id in lower},
            await self.table(),
        )
