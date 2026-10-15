"""Fresh optional-identity writers and discipline defaults against PostgreSQL."""

from __future__ import annotations

import asyncio
import sys
import uuid
from datetime import UTC, datetime
from unittest import IsolatedAsyncioTestCase
from unittest.mock import patch

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import async_sessionmaker

from shared import models
from shared.domain.forms import FormSchema, FormSection
from shared.services.ontology import project_disciplines
from shared.services.roster import roster_engine
from shared.testing import create_test_async_engine
from src.services.registration.lifecycle import lifecycle_service
from src.services.registration.service import registration_service
from src.services.registration.sheet_sync import sheet_sync_service
from src.services.tournament.flows import TournamentFlowsService


class RegistrationIdentityTests(IsolatedAsyncioTestCase):
    if sys.platform == "win32":
        loop_factory = asyncio.SelectorEventLoop

    async def asyncSetUp(self) -> None:
        self.engine = create_test_async_engine()
        self.Session = async_sessionmaker(self.engine, expire_on_commit=False)
        tag = f"optional-id-{uuid.uuid4().hex[:12]}"
        async with self.Session() as s:
            await project_disciplines(s)
            workspace = models.Workspace(slug=tag, name=tag, disciplines_enabled=["overwatch", "lol"])
            auth = models.AuthUser(email=f"{tag}@example.com", username=tag)
            s.add_all([workspace, auth])
            await s.flush()
            user = models.User(name=tag, auth_user_id=auth.id)
            grid = models.DivisionGrid(workspace_id=workspace.id, discipline="lol", slug=tag, name=tag)
            s.add_all([user, grid])
            await s.flush()
            version = models.DivisionGridVersion(grid_id=grid.id, version=1, label="v1", status="published")
            s.add(version)
            await s.flush()
            s.add(
                models.DivisionGridTier(
                    version_id=version.id,
                    slug="t-1",
                    number=1,
                    name="T 1",
                    sort_order=0,
                    rank_min=0,
                    rank_max=None,
                    icon_url="/t.png",
                )
            )
            tournament = models.Tournament(
                workspace_id=workspace.id,
                name=tag,
                slug=tag,
                discipline="lol",
                division_grid_version_id=version.id,
                start_date=datetime.now(UTC),
                end_date=datetime.now(UTC),
            )
            s.add(tournament)
            await s.commit()
            self.workspace_id, self.tournament_id = workspace.id, tournament.id
            self.auth_id, self.user_id = auth.id, user.id

    async def asyncTearDown(self) -> None:
        async with self.Session() as s:
            await s.execute(sa.delete(models.Workspace).where(models.Workspace.id == self.workspace_id))
            await s.execute(sa.delete(models.User).where(models.User.id == self.user_id))
            await s.execute(sa.delete(models.AuthUser).where(models.AuthUser.id == self.auth_id))
            await s.commit()
        await self.engine.dispose()

    async def test_manual_optional_identity_keeps_owned_player_and_unlinked_rows(self) -> None:
        async with self.Session() as s:
            linked = await lifecycle_service.create_manual_registration(
                s,
                tournament_id=self.tournament_id,
                display_name="LoL Support",
                admin_notes=None,
                auth_user_id=self.auth_id,
                roles=[
                    {
                        "role": {"dimension": "position", "role": "support"},
                        "priority": 0,
                        "is_primary": True,
                        "rank_value": 100,
                        "is_active": True,
                    }
                ],
            )
            anonymous = await lifecycle_service.create_manual_registration(
                s,
                tournament_id=self.tournament_id,
                display_name="Anonymous",
                admin_notes=None,
                roles=[],
            )
            assert linked.identities == anonymous.identities == []
            assert linked.workspace_member.player_id == self.user_id
            assert anonymous.workspace_member_id is None
            ids = linked.id, anonymous.id
        async with self.Session() as s:
            rosters = await roster_engine.for_tournament(s, self.tournament_id)
        assert set(rosters) == set(ids)
        assert rosters[ids[0]].player_id == self.user_id
        assert rosters[ids[0]].rank_on("support") == 100
        assert all(row.battle_tag is None for row in rosters.values())

    async def test_self_service_without_an_identity_question_keeps_owned_player(self) -> None:
        async with self.Session() as s:
            registration = await registration_service.create_registration(
                s,
                tournament_id=self.tournament_id,
                workspace_id=self.workspace_id,
                auth_user_id=self.auth_id,
                values={},
                schema=FormSchema(sections=[FormSection(key="details")]),
            )
            registration_id = registration.id
        async with self.Session() as s:
            loaded = await lifecycle_service.get_registration_by_id(s, registration_id)
            assert loaded.identities == []
            assert loaded.workspace_member.player_id == self.user_id

    async def test_sheet_without_game_identity_persists_and_reloads(self) -> None:
        async with self.Session() as s:
            s.add(
                models.BalancerRegistrationGoogleSheetFeed(
                    tournament_id=self.tournament_id,
                    source_url="http://sheet.example/optional",
                    sheet_id="optional",
                    mapping_config_json={
                        "targets": {
                            "source_record_key": {"mode": "columns", "columns": ["Key"], "parser": "string"},
                            "display_name": {"mode": "columns", "columns": ["Name"], "parser": "string"},
                        }
                    },
                )
            )
            await s.commit()

            async def fetch(*args, **kwargs):
                return [["Key", "Name"], ["optional", "Optional Sheet Player"]]

            with patch("src.services.registration.sheet_sync.fetch_google_sheet_rows", fetch):
                result = await sheet_sync_service.sync_google_sheet_feed(s, self.tournament_id)
            assert result.created == 1 and result.errors == []
        async with self.Session() as s:
            rosters = await roster_engine.for_tournament(s, self.tournament_id)
        assert len(rosters) == 1
        roster = next(iter(rosters.values()))
        assert roster.display_name == "Optional Sheet Player"
        assert roster.battle_tag is None and roster.player_id is None

    async def test_default_forms_and_tournament_read_follow_persisted_discipline(self) -> None:
        async with self.Session() as s:
            tournament = await lifecycle_service.common.ensure_tournament_exists(s, self.tournament_id)
            for code, provider in (("lol", "riot"), ("overwatch", "battlenet")):
                tournament.discipline = code
                if code == "overwatch":
                    tournament.division_grid_version_id = None
                await s.flush()
                schema = await sheet_sync_service._registration_schema(s, tournament.id)
                assert schema.builtin(f"identity_{provider}").required
                view = await TournamentFlowsService().to_pydantic(s, tournament, [])
                assert view.model_dump()["identity_provider"] == provider
