"""Self-service OAuth unlink guard.

The account UI renders its unlink button from ``social_account.is_verified``,
while the guard counts ``auth.oauth_connections`` — two tables nothing keeps in
sync (an admin profile merge moves verified rows between players and leaves the
connections behind). These cover the resulting states.
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

from src.services import oauth_flows  # noqa: E402


class _Scalars:
    def __init__(self, values):
        self._values = values

    def all(self):
        return self._values


class _Result:
    def __init__(self, value):
        self._value = value
        self.rowcount = value if isinstance(value, int) else 0

    def scalars(self):
        return _Scalars(self._value)


class _FakeSession:
    """Replays ``execute`` results in order: connections, [delete], unverify."""

    def __init__(self, results):
        self._results = list(results)
        self.commit_called = False

    async def execute(self, _query):
        return _Result(self._results.pop(0))

    async def scalar(self, _query):
        return SimpleNamespace(id=7)

    async def commit(self):
        self.commit_called = True


def _conn(provider: str, provider_user_id: str = "x") -> SimpleNamespace:
    return SimpleNamespace(provider=provider, provider_user_id=provider_user_id)


def test_stale_verified_mark_is_cleared_not_reported_as_last_provider() -> None:
    """A verified social account with no connection behind it: clear the mark.

    The guard used to see "1 connection total" and refuse with the last-provider
    error even though unlinking discord removes no way to sign in.
    """
    user = SimpleNamespace(id=1, hashed_password=None)
    session = _FakeSession([[_conn("battlenet")], 1])  # connections, unverify rowcount

    asyncio.run(oauth_flows.unlink(session, user, "discord"))

    assert session.commit_called is True


def test_last_real_connection_is_still_blocked_without_password() -> None:
    user = SimpleNamespace(id=1, hashed_password=None)
    session = _FakeSession([[_conn("battlenet")]])

    with pytest.raises(HTTPException) as exc:
        asyncio.run(oauth_flows.unlink(session, user, "battlenet"))

    assert exc.value.status_code == 400
    assert session.commit_called is False


def test_unlinking_several_of_one_provider_cannot_lock_you_out() -> None:
    """``provider=battlenet`` deletes *every* battlenet row — counting total
    connections (2 > 1) used to wave that through and strand a passwordless
    account with no login at all."""
    user = SimpleNamespace(id=1, hashed_password=None)
    session = _FakeSession([[_conn("battlenet", "a"), _conn("battlenet", "b")]])

    with pytest.raises(HTTPException) as exc:
        asyncio.run(oauth_flows.unlink(session, user, "battlenet"))

    assert exc.value.status_code == 400


def test_nothing_linked_and_nothing_verified_is_404() -> None:
    user = SimpleNamespace(id=1, hashed_password="hashed")
    session = _FakeSession([[], 0])

    with pytest.raises(HTTPException) as exc:
        asyncio.run(oauth_flows.unlink(session, user, "twitch"))

    assert exc.value.status_code == 404
