"""``OAuthFlowService.discord_guilds`` + ``rpc.identity.oauth_discord_guilds``.

Internal, service-to-service RPC (no gateway route — workspace self-service
design, ``docs/superpowers/specs/2026-08-26-workspace-self-service-design.md``
§4.1/§4.6): app-service calls this to prove a user administers a Discord
guild before letting a workspace claim it. Trusted broker traffic, so the
caller passes ``auth_user_id`` directly rather than a bearer token — same
trust boundary as every other internal-only subject in this stack.

No caching: computed live from the caller's stored OAuth token every call.
"""

import asyncio
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import AsyncMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import pytest  # noqa: E402

from src.core import db  # noqa: E402
from src.rpc import oauth as oauth_rpc  # noqa: E402
from src.services.oauth import oauth  # noqa: E402
from src.services.oauth_providers import OAuthTokenRejected  # noqa: E402
from tests._fakes import (
    FakeSessionMaker as _FakeSessionMaker,
)
from tests._fakes import (
    handler as _handler,
)


class _FakeConnection:
    def __init__(self, access_token: str | None, token_expires_at: datetime | None = None) -> None:
        self.access_token = access_token
        self.token_expires_at = token_expires_at


class _FakeProvider:
    def __init__(self, raw_guilds: list[dict] | None = None, *, error: Exception | None = None) -> None:
        self.get_user_guilds = AsyncMock(return_value=raw_guilds or [], side_effect=error)


def _live(token: str) -> _FakeConnection:
    return _FakeConnection(token, token_expires_at=datetime.now(UTC) + timedelta(hours=1))


RELINK = {"guilds": [], "relink_required": True}


# --- service layer ----------------------------------------------------------


def test_no_discord_connection_asks_for_a_relink(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(oauth.connections, "list_by_user_providers", AsyncMock(return_value=[]))

    assert asyncio.run(oauth.discord_guilds(None, auth_user_id=7)) == RELINK


def test_no_usable_token_asks_for_a_relink_without_calling_discord(monkeypatch: pytest.MonkeyPatch) -> None:
    """No refresh-token exchange flow exists yet for any provider in this
    codebase (verified: no ``grant_type=refresh_token`` call site anywhere) --
    a missing or expired token can only be revived by linking again.
    """
    expired = _FakeConnection("stale-token", token_expires_at=datetime.now(UTC) - timedelta(hours=1))
    monkeypatch.setattr(
        oauth.connections, "list_by_user_providers", AsyncMock(return_value=[_FakeConnection(None), expired])
    )
    fake_provider = _FakeProvider()
    monkeypatch.setattr(oauth.providers, "get", lambda name: fake_provider)

    assert asyncio.run(oauth.discord_guilds(None, auth_user_id=7)) == RELINK
    fake_provider.get_user_guilds.assert_not_awaited()


def test_a_token_discord_rejects_asks_for_a_relink(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(oauth.connections, "list_by_user_providers", AsyncMock(return_value=[_live("revoked")]))
    fake_provider = _FakeProvider(error=OAuthTokenRejected("401"))
    monkeypatch.setattr(oauth.providers, "get", lambda name: fake_provider)

    assert asyncio.run(oauth.discord_guilds(None, auth_user_id=7)) == RELINK


def test_discord_guilds_maps_owner_and_manage_guild_flags(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(oauth.connections, "list_by_user_providers", AsyncMock(return_value=[_live("live-token")]))

    raw_guilds = [
        {"id": 111, "name": "Owned Guild", "icon": "abc123", "owner": True, "permissions": "0"},
        {"id": 222, "name": "Manage Guild", "icon": None, "owner": False, "permissions": "32"},
        {"id": 333, "name": "No Rights", "owner": False, "permissions": "1024"},
    ]
    fake_provider = _FakeProvider(raw_guilds)
    monkeypatch.setattr(oauth.providers, "get", lambda name: fake_provider)

    result = asyncio.run(oauth.discord_guilds(None, auth_user_id=7))

    assert result == {
        "guilds": [
            {
                "guild_id": "111",
                "name": "Owned Guild",
                "icon_url": "https://cdn.discordapp.com/icons/111/abc123.png",
                "owner": True,
                "can_manage": True,
            },
            {"guild_id": "222", "name": "Manage Guild", "icon_url": None, "owner": False, "can_manage": True},
            {"guild_id": "333", "name": "No Rights", "icon_url": None, "owner": False, "can_manage": False},
        ],
        "relink_required": False,
    }
    fake_provider.get_user_guilds.assert_awaited_once_with("live-token")


def test_the_first_connection_with_a_usable_token_is_asked(monkeypatch: pytest.MonkeyPatch) -> None:
    """A user can link several Discord accounts (no uniqueness on
    ``(auth_user_id, provider)`` — ``OAuthConnection`` model comment). A dead
    first link must not hide a live second one.
    """
    dead = _FakeConnection("token-a", token_expires_at=datetime.now(UTC) - timedelta(hours=1))
    monkeypatch.setattr(
        oauth.connections, "list_by_user_providers", AsyncMock(return_value=[dead, _live("token-b"), _live("token-c")])
    )
    fake_provider = _FakeProvider([])
    monkeypatch.setattr(oauth.providers, "get", lambda name: fake_provider)

    assert asyncio.run(oauth.discord_guilds(None, auth_user_id=7)) == {"guilds": [], "relink_required": False}
    fake_provider.get_user_guilds.assert_awaited_once_with("token-b")


# --- RPC wiring ---------------------------------------------------------


def test_rpc_delegates_auth_user_id_and_returns_the_body(monkeypatch: pytest.MonkeyPatch) -> None:
    body = {"guilds": [{"guild_id": "111", "name": "G", "owner": True, "can_manage": True}], "relink_required": False}

    async def fake_discord_guilds(_session, auth_user_id: int):
        assert auth_user_id == 7
        return body

    monkeypatch.setattr(oauth, "discord_guilds", fake_discord_guilds)
    monkeypatch.setattr(db, "async_session_maker", _FakeSessionMaker(object()))

    handler = _handler(oauth_rpc, "rpc.identity.oauth_discord_guilds")
    reply = asyncio.run(handler({"auth_user_id": 7}, None))

    assert reply == {"ok": True, "data": body}


def test_rpc_rejects_a_missing_auth_user_id(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(db, "async_session_maker", _FakeSessionMaker(object()))

    handler = _handler(oauth_rpc, "rpc.identity.oauth_discord_guilds")
    reply = asyncio.run(handler({}, None))

    assert reply["ok"] is False
