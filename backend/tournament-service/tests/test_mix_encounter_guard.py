"""Every tournament-service entry point that loads an encounter by id answers 404 for a mix round (D77)."""

from __future__ import annotations

from shared.core.errors import BaseAPIException
from shared.tests.encounter_writer_case import EncounterWriterCase
from src import schemas
from src.rpc import pick_ban_admin
from src.services.encounter.flows import flows_service
from src.services.encounter.pick_ban_session import pick_ban_session_service
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

    async def test_the_pick_ban_room_lock_is_a_404(self) -> None:
        self.assertEqual(404, await self._status(lambda s: pick_ban_session_service._lock_encounter(s, self.mix_id)))

    async def test_the_admin_pick_ban_load_is_a_404(self) -> None:
        self.assertEqual(404, await self._status(lambda s: pick_ban_admin._load_encounter(s, self.mix_id)))

    async def test_the_workspace_encounter_list_leaves_mix_rounds_out(self) -> None:
        async with self.Session() as s:
            rows, total = await encounter_service.get_all_encounters(
                s, schemas.EncounterSearchParams(per_page=50), workspace_id=self.ids["ws"]
            )
        self.assertEqual(([self.ids["e"]], 1), ([row.id for row in rows], total))
