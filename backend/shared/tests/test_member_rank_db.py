"""Ranks are held on role ids of the discipline's rated dimension and never leak across disciplines (D87)."""

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
from shared.repository import CatalogRoleRepository, MemberHiddenRatingRepository
from shared.services.member_rank import MIX_ORDER, member_rank_service
from shared.services.ontology import project_disciplines, workspace_discipline
from shared.testing import create_test_async_engine
from shared.testing.db import ensure_test_postgres

_TAG = itertools.count()


class MemberRankDbTests(IsolatedAsyncioTestCase):
    if sys.platform == "win32":
        loop_factory = asyncio.SelectorEventLoop

    async def asyncSetUp(self) -> None:
        ensure_test_postgres()
        self.engine = create_test_async_engine()
        self.Session = async_sessionmaker(self.engine, expire_on_commit=False)
        tag = f"mr-{os.getpid()}-{next(_TAG)}"
        async with self.Session() as s:
            await project_disciplines(s)
            workspace = models.Workspace(slug=tag, name=tag, disciplines_enabled=["overwatch", "lol"])
            s.add(workspace)
            await s.flush()
            user = models.User(name=tag)
            s.add(user)
            await s.flush()
            member = models.WorkspaceMember(workspace_id=workspace.id, player_id=user.id)
            s.add(member)
            await s.commit()
            self.workspace_id, self.member_id, self.player_id = workspace.id, member.id, user.id

    async def asyncTearDown(self) -> None:
        async with self.Session() as s:
            await s.execute(sa.delete(models.Workspace).where(models.Workspace.id == self.workspace_id))
            await s.execute(sa.delete(models.User).where(models.User.id == self.player_id))
            await s.commit()
        await self.engine.dispose()

    async def _set(self, discipline: str, ranks: dict[str, int]) -> dict[str, int]:
        async with self.Session() as s:
            written = await member_rank_service.set_ranks(
                s,
                workspace_id=self.workspace_id,
                discipline=discipline,
                workspace_member_id=self.member_id,
                ranks=ranks,
            )
            await s.commit()
            return written

    async def test_set_ranks_stores_the_disciplines_module_role(self) -> None:
        self.assertEqual(await self._set("overwatch", {"tank": 2500}), {"tank": 2500})
        async with self.Session() as s:
            tank = (await CatalogRoleRepository().rated_rows(s, discipline="overwatch", workspace_id=None))["tank"]
            row = (
                await s.scalars(sa.select(models.MemberRank).where(models.MemberRank.workspace_id == self.workspace_id))
            ).one()
        self.assertEqual((row.role_id, row.dimension_id, row.role), (tank.id, tank.dimension_id, "tank"))

    async def test_another_disciplines_ranks_are_invisible_to_a_layer_and_the_resolver(self) -> None:
        await self._set("lol", {"support": 3000})
        await self._set("overwatch", {"support": 1500})
        async with self.Session() as s:
            ow = await member_rank_service.list_layer(
                s, workspace_id=self.workspace_id, discipline="overwatch", member_ids=[self.member_id]
            )
            lol = await member_rank_service.resolve(
                s,
                workspace_id=self.workspace_id,
                discipline="lol",
                members={self.member_id: None},
                roles=["support"],
                order=MIX_ORDER,
            )
        self.assertEqual(ow, {(self.member_id, "support"): 1500})
        self.assertEqual(lol[(self.member_id, "support")].value, 3000)

    async def test_a_code_outside_the_rated_dimension_is_refused(self) -> None:
        for code in ("flex", "top"):
            with self.subTest(code=code), self.assertRaises(BaseAPIException) as caught:
                await self._set("overwatch", {code: 2000})
            self.assertEqual(caught.exception.status_code, 422)

    async def test_clearing_one_discipline_preserves_the_other_and_rejects_unknown_clear_roles(self) -> None:
        await self._set("lol", {"support": 3000})
        await self._set("overwatch", {"support": 1500})
        async with self.Session() as s:
            with self.assertRaises(BaseAPIException) as caught:
                await member_rank_service.set_ranks(
                    s,
                    workspace_id=self.workspace_id,
                    discipline="overwatch",
                    workspace_member_id=self.member_id,
                    ranks={},
                    clear=["flex"],
                )
            self.assertEqual(caught.exception.status_code, 422)
            cleared = await member_rank_service.set_ranks(
                s,
                workspace_id=self.workspace_id,
                discipline="overwatch",
                workspace_member_id=self.member_id,
                ranks={},
                clear=["support"],
            )
            self.assertEqual(cleared, {})
            lol = await member_rank_service.list_layer(
                s,
                workspace_id=self.workspace_id,
                discipline="lol",
                member_ids=[self.member_id],
            )
            self.assertEqual(lol, {(self.member_id, "support"): 3000})

    async def test_rank_layer_refuses_a_discipline_without_a_rated_dimension(self) -> None:
        async with self.Session() as s:
            with self.assertRaises(BaseAPIException) as caught:
                await member_rank_service.list_layer(
                    s,
                    workspace_id=self.workspace_id,
                    discipline="unknown",
                    member_ids=[self.member_id],
                )
            self.assertEqual(caught.exception.status_code, 422)
            self.assertIn("discipline_has_no_ranks", caught.exception.detail)

    async def test_hidden_ratings_are_stored_on_role_ids_with_their_dimension(self) -> None:
        repo = MemberHiddenRatingRepository()
        async with self.Session() as s:
            mid = (await CatalogRoleRepository().rated_rows(s, discipline="lol", workspace_id=None))["mid"]
            await repo.upsert_many(s, workspace_id=self.workspace_id, ratings={(self.member_id, mid.id): (25.0, 8.0)})
            await s.commit()
            stored = await repo.for_members(s, workspace_id=self.workspace_id, member_ids=[self.member_id])
            dimension = await s.scalar(
                sa.select(models.MemberHiddenRating.dimension_id).where(
                    models.MemberHiddenRating.workspace_id == self.workspace_id
                )
            )
        self.assertEqual(stored, {(self.member_id, mid.id): (25.0, 8.0)})
        self.assertEqual(dimension, mid.dimension_id)

    async def test_workspace_discipline_refuses_a_disabled_discipline(self) -> None:
        async with self.Session() as s:
            await s.execute(
                sa.update(models.Workspace)
                .where(models.Workspace.id == self.workspace_id)
                .values(disciplines_enabled=["overwatch"])
            )
            with self.assertRaises(BaseAPIException) as caught:
                await workspace_discipline(s, workspace_id=self.workspace_id, requested="lol")
        self.assertEqual(caught.exception.status_code, 422)
