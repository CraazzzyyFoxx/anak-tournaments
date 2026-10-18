"""A game-handle autocomplete result must open the player it was found through (real DB, rolled back)."""

from __future__ import annotations

import asyncio
import sys
from unittest import IsolatedAsyncioTestCase
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.services.social_identity import social_identity_service
from shared.testing import create_test_async_engine
from src.rpc.users import register
from src.services.user.service import users


class _Broker:
    def __init__(self) -> None:
        self.handlers = {}

    def subscriber(self, subject):
        def add(fn):
            self.handlers[subject] = fn
            return fn

        return add


class RiotSearchResolutionTests(IsolatedAsyncioTestCase):
    if sys.platform == "win32":
        loop_factory = asyncio.SelectorEventLoop

    async def asyncSetUp(self) -> None:
        self.engine = create_test_async_engine()
        self.session = AsyncSession(self.engine, expire_on_commit=False)

    async def asyncTearDown(self) -> None:
        await self.session.rollback()
        await self.session.close()
        await self.engine.dispose()

    async def _by_name(self, name: str) -> dict:
        from contextlib import asynccontextmanager

        from src.rpc import users as users_rpc

        broker = _Broker()
        register(broker, type("L", (), {"exception": lambda *a, **k: None})())

        @asynccontextmanager
        async def factory():
            yield self.session

        original = users_rpc._SF
        users_rpc._SF = factory
        try:
            return await broker.handlers["rpc.app.users.by_name"]({"name": name, "query": {"entities": []}}, None)
        finally:
            users_rpc._SF = original

    async def test_riot_account_resolves_to_its_player_even_when_names_differ_and_collide(self) -> None:
        marker = uuid4().hex[:6]
        handle = f"Mid-Lane {marker}#EUW"
        owner = models.User(name=f"Legacy Owner {marker}")
        other = models.User(name=handle)  # another player whose canonical name equals the Riot handle
        self.session.add_all([owner, other])
        await self.session.flush()
        await social_identity_service.upsert(self.session, user_id=owner.id, provider="riot", username=handle)

        found = await users.search_by_name(self.session, f"Mid-Lane {marker}")
        assert [row.id for row in found] == [owner.id]
        assert found[0].name == owner.name

        # What the profile route does with the selected result: slug -> by_name.
        slug = found[0].name.replace("#", "-")
        reply = await self._by_name(slug)
        assert reply["ok"], reply
        assert reply["data"]["id"] == owner.id

        # A canonical name with its own hyphens and tag resolves without mangling.
        hyphenated = models.User(name=f"Top-Side {marker}#KR1")
        self.session.add(hyphenated)
        await self.session.flush()
        reply = await self._by_name(hyphenated.name.replace("#", "-"))
        assert reply["ok"], reply
        assert reply["data"]["id"] == hyphenated.id

    async def test_canonical_name_wins_over_a_game_handle_and_handles_only_back_old_links(self) -> None:
        marker = uuid4().hex[:6]
        # B's canonical name has a hyphen; A's Riot handle is the same text with the tag separator.
        canonical = models.User(name=f"Mid-Lane{marker}")
        riot_owner = models.User(name=f"Riot Owner {marker}")
        self.session.add_all([canonical, riot_owner])
        await self.session.flush()
        await social_identity_service.upsert(
            self.session, user_id=riot_owner.id, provider="riot", username=f"Mid#Lane{marker}"
        )

        reply = await self._by_name(f"Mid-Lane{marker}")
        assert reply["ok"], reply
        assert reply["data"]["id"] == canonical.id, "a generated link is the canonical name, not a handle"

        # An old shared link built from the Riot handle still opens its owner when no canonical name matches.
        old = await self._by_name(f"Mid#Lane{marker}")
        assert old["ok"], old
        assert old["data"]["id"] == riot_owner.id
