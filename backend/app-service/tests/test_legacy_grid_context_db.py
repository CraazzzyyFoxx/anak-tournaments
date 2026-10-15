"""Public OW statistics must not inherit a LoL-first workspace's grid."""

import asyncio
import sys
import uuid

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import async_sessionmaker

from shared import models
from shared.core.errors import BaseAPIException as HTTPException
from shared.repository.roles import CatalogRoleRepository
from shared.repository.workspace import WorkspaceRepository
from shared.services.division_grid import cache
from shared.services.workspace_scope import resolve_workspace_context
from shared.testing import create_test_async_engine
from src.rpc import users as users_rpc


def test_lol_first_public_statistics_keep_ow_divisions_with_and_without_lol_default(rpc, monkeypatch):
    async def exercise():
        engine = create_test_async_engine()
        tag = uuid.uuid4().hex
        async with engine.connect() as connection:
            transaction = await connection.begin()
            sessions = async_sessionmaker(connection, expire_on_commit=False, join_transaction_mode="create_savepoint")
            monkeypatch.setattr(users_rpc, "_SF", sessions)
            rpc.register(users_rpc)
            try:
                async with sessions() as session:
                    workspace = models.Workspace(slug=tag, name=tag, disciplines_enabled=["lol", "overwatch"])
                    user = models.User(name=tag)
                    session.add_all([workspace, user])
                    await session.flush()
                    member = models.WorkspaceMember(workspace_id=workspace.id, player_id=user.id)
                    tournament = models.Tournament(
                        workspace_id=workspace.id, name=tag, slug=tag, discipline="overwatch", is_finished=True
                    )
                    session.add_all([member, tournament])
                    await session.flush()
                    team = models.Team(tournament_id=tournament.id, name=tag, balancer_name=tag)
                    session.add(team)
                    await session.flush()
                    player = models.Player(
                        tournament_id=tournament.id,
                        team_id=team.id,
                        workspace_member_id=member.id,
                        name=tag,
                        rank=250,
                        is_substitution=False,
                        is_newcomer=False,
                        is_newcomer_role=False,
                    )
                    session.add(player)
                    await session.flush()
                    roles = await CatalogRoleRepository().rated_rows(session, discipline="overwatch", workspace_id=None)
                    role = roles["support"]
                    session.add(models.PlayerRole(player_id=player.id, dimension_id=role.dimension_id, role_id=role.id))
                    versions = {}
                    for code, number in (("overwatch", 4), ("lol", 9)):
                        version = models.DivisionGridVersion(
                            grid=models.DivisionGrid(workspace_id=workspace.id, discipline=code, slug=code, name=code),
                            version=1,
                            label=code,
                            status="published",
                            tiers=[
                                models.DivisionGridTier(
                                    slug=code,
                                    number=number,
                                    name=code,
                                    sort_order=0,
                                    rank_min=0,
                                    rank_max=None,
                                    icon_url="",
                                )
                            ],
                        )
                        session.add(version)
                        await session.flush()
                        versions[code] = version.id
                    await WorkspaceRepository().set_default_grid_version(
                        session, workspace, discipline="overwatch", version_id=versions["overwatch"]
                    )
                    await session.commit()
                    workspace_id = workspace.id

                for has_lol in (False, True):
                    async with sessions() as session:
                        if has_lol:
                            workspace = await session.get(models.Workspace, workspace_id)
                            await WorkspaceRepository().set_default_grid_version(
                                session, workspace, discipline="lol", version_id=versions["lol"]
                            )
                            await session.commit()
                        await cache.invalidate_workspace(workspace_id)
                        context = await resolve_workspace_context(session, workspace_id, discipline="overwatch")
                        assert context.grid.version_id == versions["overwatch"]
                        assert context.normalizer.target_version_id == versions["overwatch"]
                        if has_lol:
                            generic = await resolve_workspace_context(session, workspace_id)
                            assert generic.grid.version_id == versions["lol"]
                        else:
                            try:
                                await resolve_workspace_context(session, workspace_id)
                            except HTTPException as exc:
                                assert exc.status_code == 422
                                assert "division_grid_required" in exc.detail
                            else:
                                raise AssertionError("generic LoL-first context must require its own grid")
                    response = await rpc.call(
                        "rpc.app.users.overview_stats",
                        {"query": {"workspace_id": [str(workspace_id)], "divisions": ["4"]}},
                    )
                    assert response["ok"] is True, response
                    assert response["data"]["total_players"] == 1
                    assert response["data"]["division_counts"] == [{"division": 4, "count": 1}]
                    print(
                        f"PostgreSQL public OW context: enabled=[lol,overwatch], LoL assigned={has_lol}, player count=1, division=4"
                    )
            finally:
                await transaction.rollback()
            assert (
                await connection.scalar(
                    sa.select(sa.func.count()).select_from(models.Workspace).where(models.Workspace.slug == tag)
                )
                == 0
            )
            print("ROLLBACK confirmed: public-context smoke workspace rows=0")
        await engine.dispose()

    asyncio.run(exercise(), loop_factory=asyncio.SelectorEventLoop if sys.platform == "win32" else None)
