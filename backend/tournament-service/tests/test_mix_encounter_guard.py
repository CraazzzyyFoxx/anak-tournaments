"""D77 split (spec §8.2): every tournament-service read model and result path answers 404 for a mix round; the
pick-ban room paths load it."""

from __future__ import annotations

from shared.core.errors import BaseAPIException
from shared.tests.encounter_writer_case import EncounterWriterCase
from src import schemas
from src.rpc import pick_ban_admin
from src.services.encounter.captain import captain_service
from src.services.encounter.flows import flows_service
from src.services.encounter.pick_ban_session import pick_ban_session_service
from src.services.encounter.room_owner import load_room_encounter
from src.services.encounter.service import encounter_service


class MixEncounterGuardTests(EncounterWriterCase):
    async def asyncSetUp(self) -> None:
        await super().asyncSetUp()
        async with self.Session() as s:
            self.mix_id = (await self.mix_encounter(s)).id
            await s.commit()

    async def _status(self, call) -> int:
        async with self.Session() as s:
            with self.assertRaises(BaseAPIException) as ctx:
                await call(s)
        return ctx.exception.status_code

    async def test_the_encounter_page_is_a_404(self) -> None:
        self.assertEqual(404, await self._status(lambda s: flows_service.get_encounter(s, self.mix_id, [])))

    async def test_the_admin_result_load_is_a_404(self) -> None:
        self.assertEqual(404, await self._status(lambda s: pick_ban_admin._load_encounter(s, self.mix_id)))

    async def test_the_captain_report_load_is_a_404(self) -> None:
        self.assertEqual(404, await self._status(lambda s: captain_service._load_encounter(s, self.mix_id)))

    async def test_the_workspace_encounter_list_leaves_mix_rounds_out(self) -> None:
        async with self.Session() as s:
            rows, total = await encounter_service.get_all_encounters(
                s, schemas.EncounterSearchParams(per_page=50), workspace_id=self.ids["ws"]
            )
        self.assertEqual(([self.ids["e"]], 1), ([row.id for row in rows], total))

    async def test_the_pick_ban_room_paths_load_a_mix_round(self) -> None:
        async with self.Session() as s:
            self.assertEqual(self.mix_id, (await pick_ban_session_service._lock_encounter(s, self.mix_id)).id)
        async with self.Session() as s:
            self.assertEqual(self.mix_id, (await load_room_encounter(s, self.mix_id, for_update=False)).id)
