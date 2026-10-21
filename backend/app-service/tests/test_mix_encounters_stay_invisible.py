"""Workspace read models count tournament encounters only; a mix round in the same workspace is not one (D77)."""

from __future__ import annotations

from datetime import UTC, datetime

from shared.tests.encounter_writer_case import EncounterWriterCase
from src.services.dashboard.overview import AdminDashboardService, DashboardPermissions


class MixEncountersStayInvisibleTests(EncounterWriterCase):
    async def test_the_dashboard_counts_only_the_tournament_encounter(self) -> None:
        async with self.Session() as s:
            await self.mix_encounter(s)
            await s.commit()
        async with self.Session() as s:
            dashboard = await AdminDashboardService().get_dashboard(
                s,
                workspace_id=self.ids["ws"],
                permissions=DashboardPermissions(True, True, True, True, True),
                now=datetime.now(UTC),
            )
        (card,) = dashboard.tournaments
        self.assertEqual(1, card.play.encounters_total)
