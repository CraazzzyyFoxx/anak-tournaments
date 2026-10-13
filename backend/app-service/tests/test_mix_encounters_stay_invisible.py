"""Workspace read models count tournament encounters only; a mix round in the same workspace is not one (D77)."""

from __future__ import annotations

from shared.tests.encounter_writer_case import EncounterWriterCase
from src.services.dashboard.service import DashboardService


class MixEncountersStayInvisibleTests(EncounterWriterCase):
    async def test_the_dashboard_counts_only_the_tournament_encounter(self) -> None:
        async with self.Session() as s:
            await self.mix_encounter(s)
            await s.commit()
        async with self.Session() as s:
            counts = await DashboardService().get_counts(s, self.ids["ws"])
        self.assertEqual(1, counts["encounters_total"])
