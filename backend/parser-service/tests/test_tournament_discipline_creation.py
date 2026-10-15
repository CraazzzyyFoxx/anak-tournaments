from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

from shared.core.errors import BaseAPIException
from src.services.tournament import service as tournament_module


class TournamentDisciplineCreationTests(IsolatedAsyncioTestCase):
    async def test_import_cannot_create_in_a_disabled_discipline(self) -> None:
        repository = SimpleNamespace(create=AsyncMock())
        service = tournament_module.TournamentService(tournament_repo=repository)
        service.workspace_repo = SimpleNamespace(
            get=AsyncMock(return_value=SimpleNamespace(disciplines_enabled=["lol"]))
        )
        session = AsyncMock()
        with (
            patch.object(tournament_module, "generate_unique_tournament_slug", AsyncMock(return_value="imported")),
            patch.object(tournament_module, "copy_for_tournament", AsyncMock()),
            self.assertRaises(BaseAPIException) as raised,
        ):
            await service.create(session, workspace_id=1, is_league=False, name="Imported")
        self.assertEqual(raised.exception.status_code, 422)
        self.assertIn("discipline_not_enabled", str(raised.exception.detail))
        repository.create.assert_not_awaited()
        session.commit.assert_not_awaited()
