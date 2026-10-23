"""A tournament's team format is replaced only before teams form; a game's map must be of the encounter's game."""

from __future__ import annotations

from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

from shared.core.errors import BaseAPIException
from shared.schemas.team_format import TeamFormatWrite
from src.services.admin import tournament as admin_tournament
from src.services.scrim import service as scrim_module

BODY = TeamFormatWrite(
    name="Open 6", starter_min=6, starter_max=6, dimensions=[{"dimension": "player_role", "mode": "off"}], rules=[]
)
TOURNAMENT = SimpleNamespace(id=5, workspace_id=1, discipline="overwatch")


def _service() -> admin_tournament.AdminTournamentService:
    return admin_tournament.AdminTournamentService(
        tournament_repo=SimpleNamespace(get=AsyncMock(return_value=TOURNAMENT))
    )


class TournamentTeamFormatTests(IsolatedAsyncioTestCase):
    async def test_replacing_the_format_is_refused_while_a_draft_is_unfinished(self) -> None:
        refused = BaseAPIException(status_code=409, detail="draft")
        with (
            patch.object(admin_tournament, "assert_no_active_draft_session", AsyncMock(side_effect=refused)),
            patch.object(admin_tournament, "save_tournament_format", AsyncMock()) as save,
        ):
            with self.assertRaises(BaseAPIException):
                await _service().replace_team_format(AsyncMock(), 5, BODY)
        save.assert_not_awaited()

    async def test_replacing_the_format_saves_it_and_republishes_the_tournament(self) -> None:
        session = AsyncMock()
        with (
            patch.object(admin_tournament, "assert_no_active_draft_session", AsyncMock()),
            patch.object(admin_tournament, "assert_no_registered_teams", AsyncMock()),
            patch.object(admin_tournament, "save_tournament_format", AsyncMock()) as save,
            patch.object(admin_tournament, "publish_tournament_invalidation", AsyncMock()) as published,
        ):
            await _service().replace_team_format(session, 5, BODY)
        save.assert_awaited_once_with(session, TOURNAMENT, BODY.to_domain("overwatch"))
        published.assert_awaited_once()
        session.commit.assert_awaited_once()

    async def test_first_scrim_container_requires_an_enabled_discipline(self) -> None:
        service = scrim_module.ScrimService()
        service.workspace_repo = SimpleNamespace(
            get=AsyncMock(return_value=SimpleNamespace(disciplines_enabled=["lol"]))
        )
        session = AsyncMock()
        session.scalar.return_value = None
        with (
            patch.object(service.tournament_repo, "create", AsyncMock()) as create,
            patch.object(scrim_module, "copy_for_tournament", AsyncMock()),
            self.assertRaises(BaseAPIException) as raised,
        ):
            await service._ensure_container(session, 1, "overwatch")
        self.assertEqual(raised.exception.status_code, 422)
        self.assertIn("discipline_not_enabled", str(raised.exception.detail))
        create.assert_not_awaited()

    async def test_first_scrim_container_is_created_in_the_requested_game(self) -> None:
        service = scrim_module.ScrimService()
        service.workspace_repo = SimpleNamespace(
            get=AsyncMock(return_value=SimpleNamespace(disciplines_enabled=["overwatch", "lol"]))
        )
        session = AsyncMock()
        session.scalar.return_value = None
        with (
            patch.object(service.tournament_repo, "create", AsyncMock(side_effect=lambda _s, row: row)),
            patch.object(scrim_module, "copy_for_tournament", AsyncMock()),
        ):
            container = await service._ensure_container(session, 1, "lol")
        self.assertEqual((container.workspace_id, container.discipline), (1, "lol"))
        # One hidden container per workspace AND game: the slug cannot collide with another game's.
        self.assertEqual(container.slug, "scrims-1-lol")
        # The existing-container lookup is scoped to the game as well, so a LoL room never lands in
        # the Overwatch container.
        lookup = str(session.scalar.await_args.args[0].compile(compile_kwargs={"literal_binds": True}))
        self.assertIn("tournament.discipline = 'lol'", lookup)

    async def test_a_pool_copied_from_another_games_tournament_is_refused(self) -> None:
        service = scrim_module.ScrimService()
        disciplines = {40: "overwatch", 41: "lol"}
        pick_ban = SimpleNamespace(
            config=SimpleNamespace(tournament_discipline=AsyncMock(side_effect=lambda _s, tid: disciplines[tid])),
            sessions=SimpleNamespace(resolve_config_at_level=AsyncMock()),
        )
        with (
            patch.object(scrim_module, "ensure_tournament_viewable", AsyncMock()),
            patch.object(scrim_module, "_pick_ban", return_value=pick_ban),
            self.assertRaises(BaseAPIException) as raised,
        ):
            await service._build_configs(
                AsyncMock(),
                SimpleNamespace(id=1),
                {"source": "copy", "tournament_id": 40},
                tournament_id=41,
                stage_id=7,
            )
        self.assertEqual(raised.exception.status_code, 422)
        self.assertEqual(raised.exception.detail[0].code, "pool_wrong_discipline")
        pick_ban.sessions.resolve_config_at_level.assert_not_awaited()
