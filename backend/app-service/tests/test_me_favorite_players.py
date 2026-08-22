"""Favorite players: ``services.admin.favorites`` and its ``rpc.app.users.me_favorites_*``
transport.

Four things fail silently if they drift, so each is pinned here:

1. **Favorites are keyed by ``auth_user_id``, newest first.** The list query
   joins on ``FavoritePlayer.player_id`` but scopes and orders by the caller's
   own account row, not the player row — a drift here would leak someone
   else's favorites or return them in insertion order instead of most-recently
   favorited first.
2. **Add is idempotent and validates the target exists.** Favoriting an
   already-favorited player must not insert a duplicate row or raise (the
   unique constraint would otherwise turn a double-click into a 500), and
   favoriting a player id that doesn't exist is a 404, not a silently created
   orphan row.
3. **Remove is idempotent.** Unfavoriting something that was never favorited
   is a no-op, not an error — the caller doesn't know or care about the
   current state before clicking.
4. **The transport passes the *caller's own* account id.** The handler must not
   accept an ``auth_user_id`` off the request, or one user could read and edit
   another's bookmarks.

No DB and no broker: the service is driven with a fake session, and the handlers
are reached through the fake broker ``register`` subscribes against, mirroring
``test_me_stream_visibility.py``.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

from shared.core.errors import BaseAPIException
from shared.rpc.identity import MissingIdentityError
from src import models, schemas
from src.rpc import users_admin
from src.services.admin.favorites import favorites

LIST_SUBJECT = "rpc.app.users.me_favorites_list"
ADD_SUBJECT = "rpc.app.users.me_favorite_add"
REMOVE_SUBJECT = "rpc.app.users.me_favorite_remove"


class _Result:
    """A ``Result`` stand-in that answers the same value however a repository
    unwraps it (``scalar_one_or_none`` / ``unique().scalars().first()`` / ``all()``)."""

    def __init__(self, value: Any = None, rows: list | None = None) -> None:
        self._value = value
        self._rows = rows

    def unique(self) -> _Result:
        return self

    def scalars(self) -> _Result:
        return self

    def first(self) -> Any:
        return self._value

    def scalar_one_or_none(self) -> Any:
        return self._value

    def all(self) -> list:
        return self._rows or []


class _FakeSession:
    """Hands back the queued results in order and records what was written."""

    def __init__(self, *results: _Result) -> None:
        self._results = list(results)
        self.statements: list[Any] = []
        self.added: list[Any] = []
        self.deleted: list[Any] = []
        self.commits = 0

    async def execute(self, statement: Any) -> _Result:
        self.statements.append(statement)
        return self._results.pop(0)

    def add(self, instance: Any) -> None:
        self.added.append(instance)

    async def delete(self, instance: Any) -> None:
        self.deleted.append(instance)

    async def flush(self) -> None:
        return None

    async def commit(self) -> None:
        self.commits += 1


def _compiled(statement: Any) -> str:
    return str(statement.compile(compile_kwargs={"literal_binds": True}))


# --- the service ----------------------------------------------------------


class FavoritePlayerListTests(IsolatedAsyncioTestCase):
    async def test_list_scopes_to_the_caller_and_orders_newest_first(self) -> None:
        session = _FakeSession(
            _Result(rows=[SimpleNamespace(id=2, name="Bravo"), SimpleNamespace(id=1, name="Alpha")])
        )

        result = await favorites.list_for(session, 42)

        assert result == [schemas.LookupItem(id=2, name="Bravo"), schemas.LookupItem(id=1, name="Alpha")]
        compiled = _compiled(session.statements[0])
        assert "favorite_player.auth_user_id = 42" in compiled
        assert "ORDER BY players.favorite_player.created_at DESC" in compiled

    async def test_list_is_empty_when_the_caller_has_no_favorites(self) -> None:
        assert await favorites.list_for(_FakeSession(_Result(rows=[])), 42) == []


class FavoritePlayerAddTests(IsolatedAsyncioTestCase):
    async def test_add_creates_the_row_and_returns_ok(self) -> None:
        # First execute answers "player exists", second "not favorited yet".
        session = _FakeSession(_Result(True), _Result(None))

        result = await favorites.add(session, auth_user_id=42, player_id=7)

        assert result == {"ok": True}
        assert len(session.added) == 1
        added = session.added[0]
        assert isinstance(added, models.FavoritePlayer)
        assert added.auth_user_id == 42
        assert added.player_id == 7
        assert session.commits == 1

    async def test_add_is_idempotent_when_already_favorited(self) -> None:
        # A double favorite must not insert a second row or trip the unique constraint.
        existing = models.FavoritePlayer(id=99, auth_user_id=42, player_id=7)
        session = _FakeSession(_Result(True), _Result(existing))

        result = await favorites.add(session, auth_user_id=42, player_id=7)

        assert result == {"ok": True}
        assert session.added == []
        assert session.commits == 0

    async def test_add_404s_on_a_nonexistent_player(self) -> None:
        session = _FakeSession(_Result(None))

        with self.assertRaises(BaseAPIException) as ctx:
            await favorites.add(session, auth_user_id=42, player_id=999)

        assert ctx.exception.status_code == 404
        assert session.added == []
        assert session.commits == 0


class FavoritePlayerRemoveTests(IsolatedAsyncioTestCase):
    async def test_remove_deletes_an_existing_favorite(self) -> None:
        row = models.FavoritePlayer(id=5, auth_user_id=42, player_id=7)
        session = _FakeSession(_Result(row))

        assert await favorites.remove(session, auth_user_id=42, player_id=7) is None
        assert session.deleted == [row]
        assert session.commits == 1

    async def test_remove_is_idempotent_when_not_favorited(self) -> None:
        session = _FakeSession(_Result(None))

        assert await favorites.remove(session, auth_user_id=42, player_id=7) is None
        assert session.deleted == []
        assert session.commits == 0


# --- the transport --------------------------------------------------------


def _handlers() -> dict[str, Any]:
    """``register`` defines its handlers as closures, so the only honest way to reach
    one is through the decorator it registers with."""
    captured: dict[str, Any] = {}

    class _Broker:
        def subscriber(self, subject: str) -> Any:
            def decorate(fn: Any) -> Any:
                captured[subject] = fn
                return fn

            return decorate

    users_admin.register(_Broker(), SimpleNamespace(info=lambda *a, **k: None, error=lambda *a, **k: None))
    return captured


HANDLERS = _handlers()


def _actor(*, is_active: bool = True) -> SimpleNamespace:
    return SimpleNamespace(id=42, is_active=is_active, is_superuser=False, is_denied=lambda *_: False)


async def _invoke(subject: str, session: Any, data: dict | None = None, *, actor: SimpleNamespace | None = None) -> Any:
    async def _envelope(_logger: Any, _label: str, op: Any, **_kwargs: Any) -> Any:
        return await op(session)

    with (
        patch.object(users_admin.c, "actor", lambda _data: actor or _actor()),
        patch.object(users_admin.c, "envelope", _envelope),
    ):
        return await HANDLERS[subject](data or {}, None)


def test_handlers_are_registered_on_the_agreed_subjects():
    assert LIST_SUBJECT in HANDLERS
    assert ADD_SUBJECT in HANDLERS
    assert REMOVE_SUBJECT in HANDLERS


class MeFavoritesTransportTests(IsolatedAsyncioTestCase):
    """The handler names the caller's own account, never one off the request."""

    async def test_list_delegates_with_the_callers_account_id(self) -> None:
        session = object()
        with patch.object(users_admin.favorites_service, "list_for", AsyncMock(return_value=[])) as list_for:
            assert await _invoke(LIST_SUBJECT, session, {"auth_user_id": 999}) == []
        list_for.assert_awaited_once_with(session, 42)

    async def test_add_delegates_with_the_callers_account_id_and_the_requested_player(self) -> None:
        session = object()
        with patch.object(users_admin.favorites_service, "add", AsyncMock(return_value={"ok": True})) as add:
            assert await _invoke(ADD_SUBJECT, session, {"id": 7}) == {"ok": True}
        add.assert_awaited_once_with(session, auth_user_id=42, player_id=7)

    async def test_remove_delegates_with_the_callers_account_id_and_the_requested_player(self) -> None:
        session = object()
        with patch.object(users_admin.favorites_service, "remove", AsyncMock(return_value=None)) as remove:
            assert await _invoke(REMOVE_SUBJECT, session, {"id": 7}) is None
        remove.assert_awaited_once_with(session, auth_user_id=42, player_id=7)


class MeFavoritesAccessControlTests(IsolatedAsyncioTestCase):
    async def test_an_inactive_caller_is_rejected(self) -> None:
        with self.assertRaises(BaseAPIException) as ctx:
            await _invoke(LIST_SUBJECT, object(), {}, actor=_actor(is_active=False))

        assert ctx.exception.status_code == 403

    async def test_a_denied_account_capability_is_refused(self) -> None:
        denied = SimpleNamespace(id=42, is_active=True, is_superuser=False, is_denied=lambda *_: True)

        with self.assertRaises(BaseAPIException) as ctx:
            await _invoke(LIST_SUBJECT, object(), {}, actor=denied)

        assert ctx.exception.status_code == 403

    async def test_an_anonymous_caller_is_rejected(self) -> None:
        """No gateway-injected identity at all (the gateway itself refuses this
        before dispatch in production, but the handler must not trust that)."""

        async def _envelope(_logger: Any, _label: str, op: Any, **_kwargs: Any) -> Any:
            return await op(SimpleNamespace())

        with (
            patch.object(users_admin.c, "envelope", _envelope),
            self.assertRaises(MissingIdentityError),
        ):
            await HANDLERS[LIST_SUBJECT]({}, None)
