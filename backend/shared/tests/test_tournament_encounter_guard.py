"""A mix round is not a tournament encounter (D77): the tournament repository and the result lock do not see it."""

from __future__ import annotations

from shared.core.errors import BaseAPIException
from shared.models.encounter import Encounter
from shared.repository import EncounterRepository
from shared.services.encounter.result import lock_encounter
from shared.tests.encounter_writer_case import EncounterWriterCase


class TournamentEncounterGuardTests(EncounterWriterCase):
    async def asyncSetUp(self) -> None:
        await super().asyncSetUp()
        async with self.Session() as s:
            self.mix_id = (await self.mix_encounter(s)).id
            await s.commit()

    async def test_the_tournament_repository_reads_only_tournament_encounters(self) -> None:
        repo = EncounterRepository()
        async with self.Session() as s:
            self.assertIsNone(await repo.get(s, self.mix_id))
            self.assertIsNone(await repo.get_for_update(s, self.mix_id))
            self.assertEqual(self.ids["e"], (await repo.get(s, self.ids["e"])).id)

    async def test_a_workspace_list_totals_only_tournament_encounters(self) -> None:
        async with self.Session() as s:
            rows, total = await EncounterRepository().list(s, filters=[Encounter.workspace_id == self.ids["ws"]])
        self.assertEqual(([self.ids["e"]], 1), ([row.id for row in rows], total))

    async def test_locking_a_mix_round_for_a_result_is_a_404(self) -> None:
        async with self.Session() as s:
            with self.assertRaises(BaseAPIException) as ctx:
                await lock_encounter(s, self.mix_id)
        self.assertEqual(404, ctx.exception.status_code)
