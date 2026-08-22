"""``rpc.app.users.me_set_stream_visibility`` — the self-service stream veto.

Three things fail silently if they drift, so each is pinned here:

1. **It writes only the caller's own player.** The handler resolves the player from
   the actor's ``auth_user_id`` and never reads an id off the request, so a body
   naming somebody else must not move that person's flag.
2. **``UserRead`` carries the flag back.** The switch is rendered from the response;
   if the serializer drops it, the UI shows a default and the user's own setting
   silently disappears from view on every reload.
3. **``visible`` is required.** A privacy switch that defaults on a malformed body is
   a privacy switch flipped by a typo.

No DB and no broker: the handler is reached through the fake broker it registers
against and driven with a fake session, like the neighbouring
``test_me_social_no_player`` tests exercise this module.
"""

import asyncio
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from pydantic import ValidationError

from shared.core.errors import BaseAPIException
from src import models, schemas
from src.rpc import users_admin
from src.schemas.admin.user import StreamVisibilityUpdate
from src.services.user.service import UserService

SUBJECT = "rpc.app.users.me_set_stream_visibility"


class _FakeSession:
    """``scalar`` answers the "my player id" lookup; ``commit`` records the flush."""

    def __init__(self, player_id: int | None) -> None:
        self._player_id = player_id
        self.commits = 0

    async def scalar(self, _statement: Any) -> Any:
        return self._player_id

    async def commit(self) -> None:
        self.commits += 1


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


def _actor() -> SimpleNamespace:
    return SimpleNamespace(id=42, is_active=True, is_superuser=False, is_denied=lambda *_: False)


class _Call:
    """What one handler invocation did, beyond its return value."""

    def __init__(self) -> None:
        self.result: Any = None
        self.loader = AsyncMock()
        self.invalidate = AsyncMock()


def _invoke(session: _FakeSession, player: models.User | None, payload: dict) -> _Call:
    call = _Call()
    call.loader.return_value = player

    async def _envelope(_logger: Any, _label: str, op: Any, **_kwargs: Any) -> Any:
        return await op(session)

    with (
        patch.object(users_admin.c, "actor", lambda _data: _actor()),
        patch.object(users_admin.c, "require_active", lambda _user: None),
        patch.object(users_admin.c, "envelope", _envelope),
        patch.object(users_admin.admin_users, "get_user_or_404", call.loader),
        patch.object(users_admin.user_cache, "invalidate_user_caches", call.invalidate),
    ):
        call.result = asyncio.run(HANDLERS[SUBJECT]({"payload": payload}, None))
    return call


def test_handler_is_registered_on_the_agreed_subject():
    assert SUBJECT in HANDLERS


def test_setting_the_veto_writes_the_callers_own_player():
    player = models.User(id=7, name="Alice", stream_visible=True)
    session = _FakeSession(7)

    call = _invoke(session, player, {"visible": False})

    assert player.stream_visible is False
    assert session.commits == 1
    # The response is what the switch renders from, so it has to carry the new value.
    assert call.result.stream_visible is False
    call.invalidate.assert_awaited_once_with(7)


def test_clearing_the_veto_writes_it_back():
    player = models.User(id=7, name="Alice", stream_visible=False)

    call = _invoke(_FakeSession(7), player, {"visible": True})

    assert player.stream_visible is True
    assert call.result.stream_visible is True


def test_the_body_cannot_name_somebody_elses_player():
    """The player id comes from the actor, never from the request, so a body trying to
    address another player just moves the caller's own flag."""
    player = models.User(id=7, name="Alice", stream_visible=True)

    call = _invoke(_FakeSession(7), player, {"visible": False, "id": 999, "user_id": 999})

    assert call.loader.await_args.args[1] == 7


def test_a_caller_without_a_linked_player_gets_404():
    with pytest.raises(BaseAPIException) as exc:
        _invoke(_FakeSession(None), None, {"visible": False})

    assert exc.value.status_code == 404


def test_a_denied_account_capability_is_refused():
    """``account.social`` is deny-aware negative RBAC, and this endpoint honours it
    rather than inventing its own permission."""
    denied = SimpleNamespace(id=42, is_active=True, is_superuser=False, is_denied=lambda *_: True)

    async def _envelope(_logger: Any, _label: str, op: Any, **_kwargs: Any) -> Any:
        return await op(_FakeSession(7))

    with (
        patch.object(users_admin.c, "actor", lambda _data: denied),
        patch.object(users_admin.c, "require_active", lambda _user: None),
        patch.object(users_admin.c, "envelope", _envelope),
    ):
        with pytest.raises(BaseAPIException) as exc:
            asyncio.run(HANDLERS[SUBJECT]({"payload": {"visible": False}}, None))

    assert exc.value.status_code == 403


def test_the_body_must_say_which_way():
    with pytest.raises(ValidationError):
        StreamVisibilityUpdate.model_validate({})


def test_user_read_reports_the_flag_for_a_vetoed_player():
    read = UserService.to_read(models.User(id=7, name="Alice", stream_visible=False), [])

    assert read.stream_visible is False
    assert "stream_visible" in read.model_dump()


def test_user_read_fails_open_for_a_transient_user():
    """A ``User`` built in memory has no column default applied yet (it lands at
    INSERT), so the attribute is None. Reporting that as "hidden" would show the owner
    a switch that lies about their own state."""
    assert UserService.to_read(models.User(id=7, name="Alice"), []).stream_visible is True
    assert schemas.UserRead(id=0, name="").stream_visible is True
