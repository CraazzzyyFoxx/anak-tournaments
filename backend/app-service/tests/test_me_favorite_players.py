"""``rpc.app.users.me_favorites_*`` — list/add/remove a favorite player.

Three things fail silently if they drift, so each is pinned here:

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

No DB and no broker: the handlers are reached through the fake broker
``register`` subscribes against and driven with a fake session, mirroring
``test_me_stream_visibility.py``.
"""

from types import SimpleNamespace
from typing import Any
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, Mock, patch

from shared.core.errors import BaseAPIException
from shared.rpc.identity import MissingIdentityError
from src import models, schemas
from src.rpc import users_admin

LIST_SUBJECT = "rpc.app.users.me_favorites_list"
ADD_SUBJECT = "rpc.app.users.me_favorite_add"
REMOVE_SUBJECT = "rpc.app.users.me_favorite_remove"


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


class MeFavoritesListTests(IsolatedAsyncioTestCase):
    async def test_list_scopes_to_the_caller_and_orders_newest_first(self) -> None:
        captured: dict[str, Any] = {}

        async def execute(stmt: Any) -> Any:
            captured["stmt"] = stmt
            return [SimpleNamespace(id=2, name="Bravo"), SimpleNamespace(id=1, name="Alpha")]

        session = SimpleNamespace(execute=execute)

        result = await _invoke(LIST_SUBJECT, session, {})

        assert result == [schemas.LookupItem(id=2, name="Bravo"), schemas.LookupItem(id=1, name="Alpha")]
        compiled = str(captured["stmt"].compile(compile_kwargs={"literal_binds": True}))
        assert "favorite_player.auth_user_id = 42" in compiled
        assert "ORDER BY players.favorite_player.created_at DESC" in compiled

    async def test_list_is_empty_when_the_caller_has_no_favorites(self) -> None:
        session = SimpleNamespace(execute=AsyncMock(return_value=[]))
        result = await _invoke(LIST_SUBJECT, session, {})
        assert result == []


class MeFavoriteAddTests(IsolatedAsyncioTestCase):
    async def test_add_creates_the_row_and_returns_ok(self) -> None:
        session = SimpleNamespace(scalar=AsyncMock(side_effect=[7, None]), add=Mock(), commit=AsyncMock())

        result = await _invoke(ADD_SUBJECT, session, {"id": 7})

        assert result == {"ok": True}
        session.add.assert_called_once()
        added = session.add.call_args.args[0]
        assert isinstance(added, models.FavoritePlayer)
        assert added.auth_user_id == 42
        assert added.player_id == 7
        session.commit.assert_awaited_once()

    async def test_add_is_idempotent_when_already_favorited(self) -> None:
        # First scalar answers "player exists", second answers "favorite row already
        # exists" -- a double favorite must not insert a second row or error.
        session = SimpleNamespace(scalar=AsyncMock(side_effect=[7, 99]), add=Mock(), commit=AsyncMock())

        result = await _invoke(ADD_SUBJECT, session, {"id": 7})

        assert result == {"ok": True}
        session.add.assert_not_called()
        session.commit.assert_not_awaited()

    async def test_add_404s_on_a_nonexistent_player(self) -> None:
        session = SimpleNamespace(scalar=AsyncMock(return_value=None), add=Mock(), commit=AsyncMock())

        with self.assertRaises(BaseAPIException) as ctx:
            await _invoke(ADD_SUBJECT, session, {"id": 999})

        assert ctx.exception.status_code == 404
        session.add.assert_not_called()
        session.commit.assert_not_awaited()


class MeFavoriteRemoveTests(IsolatedAsyncioTestCase):
    async def test_remove_deletes_an_existing_favorite(self) -> None:
        row = models.FavoritePlayer(id=5, auth_user_id=42, player_id=7)
        session = SimpleNamespace(scalar=AsyncMock(return_value=row), delete=AsyncMock(), commit=AsyncMock())

        result = await _invoke(REMOVE_SUBJECT, session, {"id": 7})

        assert result is None
        session.delete.assert_awaited_once_with(row)
        session.commit.assert_awaited_once()

    async def test_remove_is_idempotent_when_not_favorited(self) -> None:
        session = SimpleNamespace(scalar=AsyncMock(return_value=None), delete=AsyncMock(), commit=AsyncMock())

        result = await _invoke(REMOVE_SUBJECT, session, {"id": 7})

        assert result is None
        session.delete.assert_not_awaited()
        session.commit.assert_not_awaited()


class MeFavoritesAccessControlTests(IsolatedAsyncioTestCase):
    async def test_an_inactive_caller_is_rejected(self) -> None:
        session = SimpleNamespace(execute=AsyncMock(return_value=[]))

        with self.assertRaises(BaseAPIException) as ctx:
            await _invoke(LIST_SUBJECT, session, {}, actor=_actor(is_active=False))

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
