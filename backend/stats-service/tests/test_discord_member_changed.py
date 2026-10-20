"""``discord_member_changed`` re-resolves the member's Boosty entitlement in every workspace bound to the guild."""

from __future__ import annotations

import asyncio
import importlib
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "stats-service"))
os.environ["DEBUG"] = "true"

from shared.core.social import SocialProvider
from shared.schemas.events import DiscordMemberChangedEvent

member_events = importlib.import_module("src.services.subscription_collection.member_events")

EVENT = DiscordMemberChangedEvent(guild_id="g1", discord_user_id="u1", reason="role_update")


def _wire(monkeypatch, *, workspace_ids, connection):
    resolver = SimpleNamespace(resolve=AsyncMock())
    build = MagicMock(return_value=resolver)
    monkeypatch.setattr(member_events, "build_resolver", build)
    monkeypatch.setattr(member_events._workspaces, "list_ids_by_discord_guild", AsyncMock(return_value=workspace_ids))
    monkeypatch.setattr(member_events._oauth_connections, "get_by_provider_subject", AsyncMock(return_value=connection))
    return build, resolver


def test_every_bound_workspace_is_re_resolved_for_the_linked_account_then_committed(monkeypatch):
    async def run():
        session = SimpleNamespace(commit=AsyncMock())
        build, resolver = _wire(monkeypatch, workspace_ids=[3, 4], connection=SimpleNamespace(auth_user_id=77))
        broker = object()
        assert await member_events.resync(session, EVENT, broker=broker) == [3, 4]
        assert build.call_args.kwargs["broker"] is broker
        calls = resolver.resolve.await_args_list
        assert [call.kwargs["workspace_id"] for call in calls] == [3, 4]
        assert all(
            call.kwargs["auth_user_ids"] == [77]
            and call.kwargs["providers"] == [SocialProvider.BOOSTY]
            and call.kwargs["force_refresh"]
            for call in calls
        )
        session.commit.assert_awaited_once()

    asyncio.run(run())


def test_an_unbound_guild_or_an_unlinked_member_resolves_nothing(monkeypatch):
    async def run():
        for workspace_ids, connection in (([], SimpleNamespace(auth_user_id=77)), ([3], None)):
            session = SimpleNamespace(commit=AsyncMock())
            build, _ = _wire(monkeypatch, workspace_ids=workspace_ids, connection=connection)
            assert await member_events.resync(session, EVENT, broker=object()) == []
            build.assert_not_called()
            session.commit.assert_not_awaited()

    asyncio.run(run())
