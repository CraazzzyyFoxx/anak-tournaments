"""The mix list's tabs, search and keyset pages, against the real query. Needs the test Postgres.

The filters run in SQL before the page is cut, so only a real database proves a
page is never short of rows a later page would have shown, and that the host
search sees the same name the list prints (workspace display name, else player
name, else account username).
"""

from __future__ import annotations

import asyncio
import itertools
import os
import sys
from pathlib import Path
from unittest import IsolatedAsyncioTestCase

REPO_BACKEND_ROOT = Path(__file__).resolve().parents[2]
for candidate in (str(REPO_BACKEND_ROOT), str(REPO_BACKEND_ROOT / "balancer-service")):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)

import sqlalchemy as sa  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker  # noqa: E402

from shared import models  # noqa: E402
from shared.testing import create_test_async_engine  # noqa: E402
from shared.testing.db import ensure_test_postgres  # noqa: E402
from src.services.custom_game import CustomGameService  # noqa: E402

_TAG = itertools.count()


class CustomGameListPagingTests(IsolatedAsyncioTestCase):
    if sys.platform == "win32":
        loop_factory = asyncio.SelectorEventLoop  # psycopg async cannot run on the Proactor loop

    async def asyncSetUp(self) -> None:
        ensure_test_postgres()
        self.engine = create_test_async_engine()
        self.Session = async_sessionmaker(self.engine, expire_on_commit=False)
        self.service = CustomGameService()
        tag = f"cgl-{os.getpid()}-{next(_TAG)}"
        async with self.Session() as s:
            workspace = models.Workspace(slug=tag, name=tag)
            # Rostered here under a display name; the other host never joined the roster.
            captain = models.AuthUser(username=f"{tag}-captain", email=f"{tag}-captain@example.test")
            boss = models.AuthUser(username=f"{tag}-boss", email=f"{tag}-boss@example.test")
            s.add_all([workspace, captain, boss])
            await s.flush()
            player = models.User(name=f"{tag}-player", auth_user_id=captain.id)
            s.add(player)
            await s.flush()
            s.add(models.WorkspaceMember(workspace_id=workspace.id, player_id=player.id, display_name="Captain Zed"))
            rule = models.ScoringRule(workspace_id=workspace.id, preset="wins", game_formula="win", end_formula="1")
            s.add(rule)
            await s.flush()
            self.ids: dict[str, int] = {}
            for name, status, host in (
                ("Monday 100%", "draft", captain),
                ("Tuesday", "completed", boss),
                ("Wednesday", "balanced", captain),
                ("Thursday", "cancelled", boss),
                ("Friday", "draft", boss),
            ):
                game = models.CustomGame(
                    workspace_id=workspace.id, name=name, status=status, host_user_id=host.id, scoring_rule_id=rule.id
                )
                s.add(game)
                await s.flush()
                self.ids[name.split()[0]] = game.id
            await s.commit()
            self.workspace_id = workspace.id
            self.player_id = player.id
            self.auth_ids = [captain.id, boss.id]
            self.boss_username = boss.username

    async def asyncTearDown(self) -> None:
        async with self.Session() as s:
            await s.execute(sa.delete(models.Workspace).where(models.Workspace.id == self.workspace_id))
            await s.execute(sa.delete(models.User).where(models.User.id == self.player_id))
            await s.execute(sa.delete(models.AuthUser).where(models.AuthUser.id.in_(self.auth_ids)))
            await s.commit()
        await self.engine.dispose()

    async def _page(self, **filters) -> tuple[list[str], int | None]:
        names = {game_id: name for name, game_id in self.ids.items()}
        async with self.Session() as s:
            rows, next_before_id = await self.service.list(s, workspace_id=self.workspace_id, **filters)
        return [names[row.id] for row in rows], next_before_id

    async def test_keyset_pages_walk_every_mix_newest_first_and_end_with_no_cursor(self) -> None:
        first, cursor = await self._page(limit=2)
        self.assertEqual((["Friday", "Thursday"], self.ids["Thursday"]), (first, cursor))
        second, cursor = await self._page(limit=2, before_id=cursor)
        self.assertEqual((["Wednesday", "Tuesday"], self.ids["Tuesday"]), (second, cursor))
        # The last page says so: no cursor pointing at an empty page.
        self.assertEqual((["Monday"], None), await self._page(limit=2, before_id=cursor))
        # Exactly `limit` rows left is still the last page.
        self.assertEqual(
            (["Wednesday", "Tuesday", "Monday"], None), await self._page(limit=3, before_id=self.ids["Thursday"])
        )

    async def test_status_tabs_split_open_from_history(self) -> None:
        self.assertEqual((["Friday", "Wednesday", "Monday"], None), await self._page(limit=30, status="open"))
        self.assertEqual((["Thursday", "Tuesday"], None), await self._page(limit=30, status="history"))

    async def test_search_matches_the_mix_name_or_the_host_name_the_list_shows(self) -> None:
        # The rostered host is found by their workspace display name, any case.
        self.assertEqual(["Wednesday", "Monday"], (await self._page(limit=30, search="captain zed"))[0])
        # The unrostered host by the account username the list falls back to.
        self.assertEqual(["Friday", "Thursday", "Tuesday"], (await self._page(limit=30, search=self.boss_username))[0])
        self.assertEqual(["Thursday"], (await self._page(limit=30, search="THURS"))[0])
        # A LIKE wildcard in the needle is a literal character, not "match anything".
        self.assertEqual(["Monday"], (await self._page(limit=30, search="%"))[0])

    async def test_filters_apply_before_the_page_is_cut(self) -> None:
        first, cursor = await self._page(limit=1, status="open", search="captain")
        self.assertEqual((["Wednesday"], self.ids["Wednesday"]), (first, cursor))
        self.assertEqual(
            (["Monday"], None), await self._page(limit=1, status="open", search="captain", before_id=cursor)
        )
