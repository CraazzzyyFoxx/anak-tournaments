"""A hand-drawn template is a real bracket: persisted, its advancement links
carry every result to the Grand Final, and the Reset still fires off them.

The Reset rule itself (which slot the lower champion plays in, no second Reset,
no Reset on a ``no_reset`` stage) is pinned in ``shared/tests/test_bracket_positions.py``.
Needs the test Postgres.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import sqlalchemy as sa

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "tournament-service"))

os.environ["DEBUG"] = "true"

from shared.core import enums  # noqa: E402
from shared.models.encounter import Encounter  # noqa: E402
from shared.models.tournament.bracket_encounter import BracketEncounter  # noqa: E402
from shared.models.tournament.encounter_link import EncounterLink  # noqa: E402
from shared.services.encounter import participants  # noqa: E402
from src.domain.bracket import template as bracket_template
from src.domain.bracket.engine import placeholder_seeds  # noqa: E402
from src.domain.stage.seeds import resolve_seeds  # noqa: E402
from src.services.bracket import advancement  # noqa: E402
from tests.test_bracket_positions import BracketCase  # noqa: E402
from tests.test_bracket_template import _sketch  # noqa: E402


class CustomTemplateBracketPlaythroughTests(BracketCase):
    stage_type = enums.StageType.DOUBLE_ELIMINATION
    grand_final_type = "with_reset"
    team_count = 8

    async def test_the_sketch_template_plays_through_to_a_grand_final_reset(self) -> None:
        teams = self.team_ids  # teams[0] is seed 1
        skeleton = resolve_seeds(
            bracket_template.template_to_skeleton(bracket_template.BracketTemplate.model_validate(_sketch())),
            dict(zip(placeholder_seeds(8), teams, strict=True)),
        )

        async with self.Session() as s:
            encounters = await self.build(s, skeleton)
            self.assertEqual(10, len(encounters))
            # Seeds only; every other slot waits on a link.
            self.assertEqual(
                [(1, 4), (2, 3), (None, None), (5, 8), (6, 7)],
                [
                    tuple(None if team is None else teams.index(team) + 1 for team in pairing.team_ids)
                    for pairing in skeleton.pairings[:5]
                ],
            )

            # The upper seeds win their halves; team 5 runs the whole lower
            # bracket and takes the Grand Final from the LB side.
            for index, winner in ((0, 1), (1, 2), (2, 1), (3, 5), (4, 6), (5, 5), (6, 6), (7, 5), (8, 5)):
                await self._play(s, encounters[index], teams[winner - 1])

            grand_final = encounters[9]
            self.assertEqual(
                [(1, teams[0]), (2, teams[4])],
                [(seat.slot, seat.team_id) for seat in await participants.active_teams(s, grand_final.id)],
            )
            await self._play(s, grand_final, teams[4])

            reset_id = await s.scalar(
                sa.select(EncounterLink.target_encounter_id).where(EncounterLink.source_encounter_id == grand_final.id)
            )
            self.assertIsNotNone(reset_id, "the lower champion winning the Grand Final materialises a Reset")
            reset = await s.get_one(Encounter, reset_id)
            self.assertEqual(
                (await s.get_one(BracketEncounter, grand_final.id)).round + 1,
                (await s.get_one(BracketEncounter, reset_id)).round,
            )
            self.assertEqual(grand_final.best_of, reset.best_of)
            self.assertEqual(
                [(1, teams[0]), (2, teams[4])],
                [(seat.slot, seat.team_id) for seat in await participants.active_teams(s, reset_id)],
            )
            links = (
                (await s.execute(sa.select(EncounterLink).where(EncounterLink.source_encounter_id == grand_final.id)))
                .scalars()
                .all()
            )
            self.assertEqual({(1, 2), (2, 1)}, {(link.source_position, link.target_slot) for link in links})

    async def _play(self, session, encounter: Encounter, winner_team_id: int) -> None:
        seat = next(
            seat for seat in await participants.active_teams(session, encounter.id) if seat.team_id == winner_team_id
        )
        await self.win(session, encounter, winner_slot=seat.slot)
        await advancement.advance_after_result(session, encounter)
