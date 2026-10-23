"""A workspace's mix list narrows to one game, and the game filter rejects an uninstalled code. Needs the test Postgres."""

from __future__ import annotations

import asyncio
import itertools
import os
import sys
from unittest import IsolatedAsyncioTestCase

import pytest
import sqlalchemy as sa
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import async_sessionmaker

from shared import models
from shared.repository.custom_game import CustomGameRepository
from shared.rpc.query import build_query_model
from shared.schemas.discipline_filter import DisciplineFilterQuery
from shared.testing import create_test_async_engine
from shared.testing.db import ensure_test_postgres

_TAG = itertools.count()


class CustomGameListDisciplineTests(IsolatedAsyncioTestCase):
    if sys.platform == "win32":
        loop_factory = asyncio.SelectorEventLoop

    async def asyncSetUp(self) -> None:
        ensure_test_postgres()
        self.engine = create_test_async_engine()
        self.Session = async_sessionmaker(self.engine, expire_on_commit=False)
        tag = f"cgld-{os.getpid()}-{next(_TAG)}"
        async with self.Session() as s:
            workspace = models.Workspace(slug=tag, name=tag)
            s.add(workspace)
            await s.flush()
            self.workspace_id = workspace.id
            rule = models.ScoringRule(workspace_id=workspace.id, preset="wins", game_formula="win", end_formula="1")
            s.add(rule)
            await s.flush()
            self.ids: dict[str, int] = {}
            for discipline in ("overwatch", "lol"):
                game = models.CustomGame(
                    workspace_id=workspace.id,
                    name=f"{tag}-{discipline}",
                    scoring_rule_id=rule.id,
                    discipline=discipline,
                )
                s.add(game)
                await s.flush()
                self.ids[discipline] = game.id
            await s.commit()

    async def asyncTearDown(self) -> None:
        async with self.Session() as s:
            await s.execute(sa.delete(models.Workspace).where(models.Workspace.id == self.workspace_id))
            await s.commit()
        await self.engine.dispose()

    async def test_the_list_is_one_games_or_every_game(self) -> None:
        repo = CustomGameRepository()
        async with self.Session() as s:
            every = {row.id for row in await repo.list_for_workspace(s, self.workspace_id)}
            lol = [row.id for row in await repo.list_for_workspace(s, self.workspace_id, "lol")]
        assert every == set(self.ids.values())
        assert lol == [self.ids["lol"]]


@pytest.mark.parametrize("bogus", ["starcraft", "", "all"])
def test_an_uninstalled_game_is_a_validation_error(bogus: str) -> None:
    with pytest.raises(ValidationError):
        build_query_model(DisciplineFilterQuery, {"discipline": [bogus]})
    assert build_query_model(DisciplineFilterQuery, {"discipline": ["lol"]}).discipline == "lol"
    assert build_query_model(DisciplineFilterQuery, {}).discipline is None
