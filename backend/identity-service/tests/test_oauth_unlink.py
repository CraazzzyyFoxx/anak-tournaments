"""Self-service OAuth unlink guard (``oauth.unlink``).

The account UI renders its unlink button from ``social_account.is_verified``,
while the guard counts ``auth.oauth_connections`` — two tables nothing keeps in
sync (an admin profile merge moves verified rows between players and leaves the
connections behind). These cover the resulting states.

The three collaborators the flow reads through (OAuth connections, player
lookup, social marks) are injected as stubs, so each test states the DB shape it
is about in one line instead of scripting a sequence of ``session.execute``
results.
"""

import asyncio
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from shared.core.errors import BaseAPIException as HTTPException


def _ensure_test_env() -> None:
    env = {
        "POSTGRES_HOST": "localhost",
        "POSTGRES_PORT": "5432",
        "POSTGRES_DB": "auth_test",
        "POSTGRES_USER": "postgres",
        "POSTGRES_PASSWORD": "postgres",
        "JWT_SECRET_KEY": "test-secret",
        "DISCORD_CLIENT_ID": "discord-client",
        "DISCORD_CLIENT_SECRET": "discord-secret",
        "TWITCH_CLIENT_ID": "twitch-client",
        "TWITCH_CLIENT_SECRET": "twitch-secret",
        "BATTLENET_CLIENT_ID": "battlenet-client",
        "BATTLENET_CLIENT_SECRET": "battlenet-secret",
        "OAUTH_REDIRECT": "http://localhost:3000/auth/callback",
    }
    for key, value in env.items():
        os.environ.setdefault(key, value)


_ensure_test_env()

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from src.services.oauth import OAuthFlowService  # noqa: E402


class _FakeConnections:
    """``OAuthConnectionRepository`` stand-in over an in-memory row list."""

    def __init__(self, conns):
        self.conns = list(conns)
        self.deleted: list[tuple[str, str | None]] = []

    async def list_by_user(self, session, auth_user_id):
        return list(self.conns)

    async def delete_for_provider(self, session, *, auth_user_id, provider, provider_user_id=None):
        gone = [
            conn
            for conn in self.conns
            if conn.provider == provider and (provider_user_id is None or conn.provider_user_id == provider_user_id)
        ]
        for conn in gone:
            self.conns.remove(conn)
        self.deleted.append((provider, provider_user_id))
        return len(gone)


class _FakeSocials:
    """``SocialAccountRepository`` stand-in; ``unverified`` is the rowcount."""

    def __init__(self, unverified: int = 0):
        self._unverified = unverified
        self.calls: list[SimpleNamespace] = []

    async def unverify_for_player(self, session, *, user_id, provider, provider_user_id=None):
        self.calls.append(SimpleNamespace(user_id=user_id, provider=provider, provider_user_id=provider_user_id))
        return self._unverified


_LINKED_PLAYER = SimpleNamespace(id=7)


class _FakePlayers:
    """``UserRepository`` stand-in; ``player=None`` models an auth user with no
    linked player row at all."""

    def __init__(self, player):
        self._player = player

    async def get_by_auth_user_id(self, session, auth_user_id):
        return self._player


class _FakeSession:
    def __init__(self):
        self.commit_called = False

    async def commit(self):
        self.commit_called = True


def _conn(provider: str, provider_user_id: str = "x") -> SimpleNamespace:
    return SimpleNamespace(provider=provider, provider_user_id=provider_user_id)


def _service(conns, *, unverified: int = 0, player=_LINKED_PLAYER):
    """``OAuthFlowService`` wired to in-memory collaborators.

    Returns ``(service, connections, socials)`` so a test can assert on what was
    actually asked of each one.
    """
    connections = _FakeConnections(conns)
    socials = _FakeSocials(unverified)
    service = OAuthFlowService(connections=connections, socials=socials, players=_FakePlayers(player))
    return service, connections, socials


def test_stale_verified_mark_is_cleared_not_reported_as_last_provider() -> None:
    """A verified social account with no connection behind it: clear the mark.

    The guard used to see "1 connection total" and refuse with the last-provider
    error even though unlinking discord removes no way to sign in.
    """
    user = SimpleNamespace(id=1, hashed_password=None)
    service, connections, socials = _service([_conn("battlenet")], unverified=1)
    session = _FakeSession()

    asyncio.run(service.unlink(session, user, "discord"))

    assert session.commit_called is True
    # Nothing to delete -- only the unprovable verified mark was released.
    assert connections.deleted == []
    assert [call.provider for call in socials.calls] == ["discord"]


def test_last_real_connection_is_still_blocked_without_password() -> None:
    user = SimpleNamespace(id=1, hashed_password=None)
    service, connections, _socials = _service([_conn("battlenet")])
    session = _FakeSession()

    with pytest.raises(HTTPException) as exc:
        asyncio.run(service.unlink(session, user, "battlenet"))

    assert exc.value.status_code == 400
    assert exc.value.detail == "Cannot unlink last OAuth provider. Set a password first."
    assert session.commit_called is False
    assert connections.deleted == []


def test_last_connection_may_be_unlinked_once_a_password_exists() -> None:
    """The guard is about lockout, not about keeping a provider: a password is
    a way back in, so the same last connection becomes removable."""
    user = SimpleNamespace(id=1, hashed_password="hashed")
    service, connections, _socials = _service([_conn("battlenet")])
    session = _FakeSession()

    asyncio.run(service.unlink(session, user, "battlenet"))

    assert session.commit_called is True
    assert connections.deleted == [("battlenet", None)]
    assert connections.conns == []


def test_unlinking_several_of_one_provider_cannot_lock_you_out() -> None:
    """``provider=battlenet`` deletes *every* battlenet row — counting total
    connections (2 > 1) used to wave that through and strand a passwordless
    account with no login at all."""
    user = SimpleNamespace(id=1, hashed_password=None)
    service, connections, _socials = _service([_conn("battlenet", "a"), _conn("battlenet", "b")])
    session = _FakeSession()

    with pytest.raises(HTTPException) as exc:
        asyncio.run(service.unlink(session, user, "battlenet"))

    assert exc.value.status_code == 400
    assert session.commit_called is False
    assert connections.deleted == []


def test_unlinking_one_specific_subject_leaves_the_other_and_is_allowed() -> None:
    """The narrowed form removes exactly one row, so a passwordless account
    keeps a battlenet login and the guard must let it through -- the mirror
    image of the un-narrowed case above."""
    user = SimpleNamespace(id=1, hashed_password=None)
    service, connections, socials = _service([_conn("battlenet", "a"), _conn("battlenet", "b")])
    session = _FakeSession()

    asyncio.run(service.unlink(session, user, "battlenet", provider_user_id="a"))

    assert session.commit_called is True
    # The subject is forwarded to BOTH the deletion and the verified-mark
    # release, so the surviving connection keeps its own mark.
    assert connections.deleted == [("battlenet", "a")]
    assert [conn.provider_user_id for conn in connections.conns] == ["b"]
    assert [(call.provider, call.provider_user_id) for call in socials.calls] == [("battlenet", "a")]


def test_nothing_linked_and_nothing_verified_is_404() -> None:
    user = SimpleNamespace(id=1, hashed_password="hashed")
    service, connections, _socials = _service([], unverified=0)
    session = _FakeSession()

    with pytest.raises(HTTPException) as exc:
        asyncio.run(service.unlink(session, user, "twitch"))

    assert exc.value.status_code == 404
    assert exc.value.detail == "Twitch account not linked"
    assert session.commit_called is False
    assert connections.deleted == []


def test_unlink_without_a_player_row_still_404s_when_nothing_was_linked() -> None:
    """No linked player at all: there is no verified mark to fall back on, so a
    provider that was never connected is still a 404 rather than a silent no-op
    -- and the social table is never consulted."""
    user = SimpleNamespace(id=1, hashed_password="hashed")
    service, _connections, socials = _service([_conn("discord")], unverified=1, player=None)
    session = _FakeSession()

    with pytest.raises(HTTPException) as exc:
        asyncio.run(service.unlink(session, user, "twitch"))

    assert exc.value.status_code == 404
    assert socials.calls == []
    assert session.commit_called is False
