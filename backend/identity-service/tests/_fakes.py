"""Shared test doubles for identity-service.

``FakeRedisClient``/``DownRedisClient`` were copy-pasted verbatim into four
test files (``test_oauth_callback_flow.py``, ``test_oauth_link_flow.py``,
``test_sso_tickets.py``, ``test_pending_link_tickets.py``). No behavioral
divergence between the copies -- single source of truth here. Both take an
``nx`` kwarg on ``set()`` (set-if-absent), folding in what used to be two
``_NxRedisClient``/``_NxDownRedisClient`` subclasses duplicated verbatim in
``test_oauth_link_flow.py`` and ``test_oauth_callback_flow.py`` -- callers
that never pass ``nx`` are unaffected.

``make_auth_user``/``make_workspace`` were hand-rolled identically as
``_owner``/``_user``/``_api_actor`` (three names, one ``AuthUser`` shape) and
``_workspace`` in ``test_api_key_credential.py``, ``test_api_key_service.py``,
and ``test_audit_identity.py``. ``FakeExecuteResult`` was hand-rolled
identically in ``test_api_key_service.py`` and ``test_auth_sessions.py``.

``FakeSessionMaker`` was hand-rolled identically as ``_SessionMaker``
(``test_api_key_credential.py``) and ``_FakeSessionMaker``
(``test_discord_guilds_rpc.py``). ``CapturingBroker``/``SilentLogger``/
``handler`` were hand-rolled identically in the same two files.

``FakeOAuthConnections``/``FakeSocialAccounts`` are the union of
``OAuthConnectionRepository``/``SocialAccountRepository`` stand-ins
duplicated (under different names, with non-overlapping method subsets) as
``_FakeConnections``/``_FakeSocials`` in ``test_oauth_unlink.py`` and
``_StubConnections``/``_StubSocials`` in ``test_player_link_service.py``.
``UserRepository`` (players) is NOT included here: the two files' stand-ins
disagree on whether ``get_by_auth_user_id`` validates its argument, so each
keeps its own local fake rather than risk silently picking one semantics.

``FakeSessionCache`` is the union of the ``session_cache`` singleton
stand-ins scattered (under five different names, several colliding across
files with DIFFERENT bodies -- ``_NoopCache``/``_RecordingCache`` meant two
different things in different files) across ``test_auth_sessions.py``,
``test_rbac_admin_users.py``, ``test_audit_identity.py``,
``test_rbac_user_deny_workspace.py``, and ``test_token_workspace_membership.py``.
Every method always records -- a caller that never asserts on a given
attribute simply never reads it back, so recording instead of no-op-ing is
strictly safe.
"""

from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from redis.exceptions import ConnectionError as RedisConnectionError

# Same bootstrap the suites use, so this module is importable on its own
# rather than only after whichever test happened to be collected first
# patched `sys.path`.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from src import models  # noqa: E402


class FakeRedisClient:
    """Dict-backed double: real ``set``/``getdel`` semantics, no TTL enforcement.

    ``nx`` (set-if-absent) matches ``SETNX``, needed by the state-nonce claim;
    callers that never pass it get the plain unconditional write.
    """

    def __init__(self) -> None:
        self._store: dict[str, str] = {}

    async def set(self, key: str, value: str, ex: int | None = None, nx: bool = False) -> bool | None:
        if nx and key in self._store:
            return None
        self._store[key] = value
        return True

    async def getdel(self, key: str) -> str | None:
        return self._store.pop(key, None)


class DownRedisClient:
    """Simulates an unreachable Redis for every op this module uses."""

    async def set(self, key: str, value: str, ex: int | None = None, nx: bool = False) -> bool | None:
        raise RedisConnectionError("redis unavailable")

    async def getdel(self, key: str) -> str | None:
        raise RedisConnectionError("redis unavailable")


def make_auth_user(*, active: bool = True) -> models.AuthUser:
    """The standard ``ada@example.com``/``ada`` non-superuser, verified account."""
    return models.AuthUser(
        id=7,
        email="ada@example.com",
        username="ada",
        is_active=active,
        is_superuser=False,
        is_verified=True,
    )


def make_workspace(*, active: bool = True) -> models.Workspace:
    return models.Workspace(id=11, slug="main", name="Main", is_active=active)


class FakeExecuteResult:
    """A ``session.execute(...)`` result: ``scalar_one_or_none()`` or ``scalars().all()``."""

    def __init__(self, scalar: object = None, scalars: list | None = None) -> None:
        self._scalar = scalar
        self._scalars = list(scalars or [])

    def scalar_one_or_none(self) -> object:
        return self._scalar

    def scalars(self) -> SimpleNamespace:
        return SimpleNamespace(all=lambda: list(self._scalars))


class FakeSessionMaker:
    """Stands in for ``db.async_session_maker``: one session, no engine."""

    def __init__(self, session: Any) -> None:
        self._session = session

    def __call__(self) -> "FakeSessionMaker":
        return self

    async def __aenter__(self) -> Any:
        return self._session

    async def __aexit__(self, *exc: object) -> bool:
        return False


class CapturingBroker:
    """Records the handler behind each subject instead of binding a queue."""

    def __init__(self) -> None:
        self.handlers: dict[str, object] = {}

    def subscriber(self, subject: str):
        def decorator(fn):
            self.handlers[subject] = fn
            return fn

        return decorator


class SilentLogger:
    def exception(self, *args: object, **kwargs: object) -> None:
        return None


def handler(module: Any, subject: str):
    """Register ``module``'s RPC subscribers against a fresh ``CapturingBroker``
    and return the handler bound to ``subject``."""
    broker = CapturingBroker()
    module.register(broker, SilentLogger())
    return broker.handlers[subject]


class FakeOAuthConnections:
    """Stands in for ``OAuthConnectionRepository`` over an in-memory row list."""

    def __init__(self, connections: Any = ()) -> None:
        self.conns = list(connections)
        self.deleted: list[tuple[str, str | None]] = []

    async def list_by_user(self, session: Any, auth_user_id: int) -> list:
        return list(self.conns)

    async def list_by_user_providers(self, session: Any, *, auth_user_id: int, providers: Any) -> list:
        return [conn for conn in self.conns if conn.provider in providers]

    async def delete_for_provider(
        self, session: Any, *, auth_user_id: int, provider: str, provider_user_id: str | None = None
    ) -> int:
        gone = [
            conn
            for conn in self.conns
            if conn.provider == provider and (provider_user_id is None or conn.provider_user_id == provider_user_id)
        ]
        for conn in gone:
            self.conns.remove(conn)
        self.deleted.append((provider, provider_user_id))
        return len(gone)


class FakeSocialAccounts:
    """Stands in for ``SocialAccountRepository``."""

    def __init__(self, *, handles: dict | None = None, unverified: int = 0) -> None:
        self._handles = dict(handles or {})
        self._unverified = unverified
        self.calls: list[SimpleNamespace] = []

    async def list_handles(self, session: Any, *, user_id: int, provider: str) -> list:
        return list(self._handles.get(provider, []))

    async def unverify_for_player(
        self, session: Any, *, user_id: int, provider: str, provider_user_id: str | None = None
    ) -> int:
        self.calls.append(SimpleNamespace(user_id=user_id, provider=provider, provider_user_id=provider_user_id))
        return self._unverified


class FakeSessionCache:
    """Stands in for the ``session_cache`` singleton, recording every call.

    Pass ``rbac_entry`` to make ``get_rbac`` return a fixed cache hit (for the
    tests that check a full hit skips the database); leave it ``None`` for
    every flow that only writes/invalidates/blacklists and never reads a
    cached RBAC entry back.
    """

    def __init__(self, rbac_entry: dict | None = None) -> None:
        self.rbac_entry = rbac_entry
        self.reads = 0
        self.writes: list[tuple[int, dict]] = []
        self.invalidated: list[int] = []
        self.blacklisted: list[tuple[str, int]] = []

    async def get_rbac(self, user_id: int) -> dict | None:
        self.reads += 1
        return self.rbac_entry

    async def set_rbac(self, user_id: int, **payload: object) -> None:
        self.writes.append((user_id, payload))

    async def invalidate_rbac(self, user_id: int) -> None:
        self.invalidated.append(user_id)

    async def blacklist_session(self, session_id: str, ttl_seconds: int) -> None:
        self.blacklisted.append((session_id, ttl_seconds))

    async def blacklist_sessions(self, session_ids: set, ttl_seconds: int) -> None:
        for session_id in sorted(session_ids):
            await self.blacklist_session(session_id, ttl_seconds)
