"""Mix player roles are stored by ``role_id`` and read back as codes (D91). Needs the test Postgres."""

from __future__ import annotations

import asyncio
import itertools
import os
import sys
from unittest import IsolatedAsyncioTestCase

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import async_sessionmaker

from shared import models
from shared.core.errors import BaseAPIException
from shared.repository.custom_game import CustomGamePlayerRoleRepository
from shared.testing import create_test_async_engine
from shared.testing.db import ensure_test_postgres

_TAG = itertools.count()


class CustomGamePlayerRoleTests(IsolatedAsyncioTestCase):
    if sys.platform == "win32":
        loop_factory = asyncio.SelectorEventLoop

    async def asyncSetUp(self) -> None:
        ensure_test_postgres()
        self.engine = create_test_async_engine()
        self.Session = async_sessionmaker(self.engine, expire_on_commit=False)
        tag = f"cgpr-{os.getpid()}-{next(_TAG)}"
        async with self.Session() as s:
            workspace = models.Workspace(slug=tag, name=tag)
            s.add(workspace)
            await s.flush()
            self.workspace_id = workspace.id
            rule = models.ScoringRule(workspace_id=workspace.id, preset="wins", game_formula="win", end_formula="1")
            s.add(rule)
            await s.flush()
            game = models.CustomGame(workspace_id=workspace.id, name=tag, scoring_rule_id=rule.id)
            user = models.User(name=tag)
            s.add_all([game, user])
            await s.flush()
            self.user_id = user.id
            member = models.WorkspaceMember(workspace_id=workspace.id, player_id=user.id)
            s.add(member)
            await s.flush()
            player = models.CustomGamePlayer(custom_game_id=game.id, workspace_member_id=member.id)
            s.add(player)
            await s.commit()
            self.player_id = player.id

    async def asyncTearDown(self) -> None:
        async with self.Session() as s:
            await s.execute(sa.delete(models.Workspace).where(models.Workspace.id == self.workspace_id))
            await s.execute(sa.delete(models.User).where(models.User.id == self.user_id))
            await s.commit()
        await self.engine.dispose()

    async def test_mix_roles_are_stored_by_role_id_and_read_back_as_codes(self) -> None:
        repo = CustomGamePlayerRoleRepository()
        async with self.Session() as s:
            await repo.replace_for_player(s, self.player_id, ["support", "tank"], discipline="overwatch")
            await s.commit()
            assert await repo.roles_for_players(s, [self.player_id]) == {self.player_id: ["support", "tank"]}
            rows = (
                await s.scalars(
                    sa.select(models.CustomGamePlayerRole)
                    .where(models.CustomGamePlayerRole.custom_game_player_id == self.player_id)
                    .order_by(models.CustomGamePlayerRole.priority)
                )
            ).all()
            assert [row.catalog_role.code for row in rows] == ["support", "tank"]
            assert all(
                row.role_id == row.catalog_role.id and row.dimension_id == row.catalog_role.dimension_id for row in rows
            )
            assert all(row.catalog_role.workspace_id is None for row in rows)
            s.add(
                models.CatalogRole(
                    dimension_id=rows[0].dimension_id,
                    workspace_id=self.workspace_id,
                    parent_role_id=rows[0].role_id,
                    code="support_main",
                    name="Main Support",
                )
            )
            await s.flush()
            for invalid in ("healer", "top", "flex", "support_main"):
                with self.assertRaisesRegex(BaseAPIException, "unknown_role"):
                    await repo.replace_for_player(s, self.player_id, [invalid], discipline="overwatch")
            assert await repo.roles_for_players(s, [self.player_id]) == {self.player_id: ["support", "tank"]}
