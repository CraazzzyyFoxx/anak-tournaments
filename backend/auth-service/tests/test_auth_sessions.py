import asyncio
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException


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

from src import schemas  # noqa: E402
from src.routes import auth as auth_routes  # noqa: E402
from src.services.auth_service import AuthService  # noqa: E402


class _FakeExecuteResult:
    def __init__(self, *, scalar=None, scalars=None) -> None:
        self._scalar = scalar
        self._scalars = list(scalars or [])

    def scalar_one_or_none(self):
        return self._scalar

    def scalars(self):
        return SimpleNamespace(all=lambda: list(self._scalars))


class _FakeSession:
    def __init__(self, results: list[dict]) -> None:
        self._results = list(results)
        self.executed = []
        self.commit_calls = 0

    async def execute(self, stmt):
        self.executed.append(stmt)
        if not self._results:
            raise AssertionError("Unexpected execute() call")
        return _FakeExecuteResult(**self._results.pop(0))

    async def commit(self) -> None:
        self.commit_calls += 1


def test_revoke_user_session_tokens_revokes_only_matching_browser() -> None:
    chrome_primary = SimpleNamespace(user_id=7, user_agent="Chrome", ip_address="10.0.0.1", is_revoked=False)
    firefox = SimpleNamespace(user_id=7, user_agent="Firefox", ip_address="10.0.0.1", is_revoked=False)
    chrome_rotated = SimpleNamespace(user_id=7, user_agent="Chrome", ip_address="10.0.0.2", is_revoked=False)
    already_revoked = SimpleNamespace(user_id=7, user_agent="Chrome", ip_address="10.0.0.1", is_revoked=True)

    session = _FakeSession(
        [
            {"scalars": [chrome_primary, firefox, chrome_rotated, already_revoked]},
        ]
    )

    revoked = asyncio.run(
        AuthService.revoke_user_session_tokens(
            session,
            user_id=7,
            user_agent="Chrome",
            ip_address="10.0.0.1",
            commit=False,
        )
    )

    assert revoked == 2
    assert chrome_primary.is_revoked is True
    assert chrome_rotated.is_revoked is True
    assert firefox.is_revoked is False
    assert already_revoked.is_revoked is True
    assert session.commit_calls == 0


def test_get_user_by_refresh_token_reuse_revokes_only_same_browser(monkeypatch: pytest.MonkeyPatch) -> None:
    reused_token = SimpleNamespace(user_id=42, user_agent="Chrome", ip_address="10.0.0.1")
    session = _FakeSession(
        [
            {"scalar": None},
            {"scalar": reused_token},
        ]
    )

    scoped_revocations: list[tuple[int, str | None, str | None, bool]] = []
    global_revocations: list[int] = []

    async def fake_revoke_user_session_tokens(session, user_id, user_agent, ip_address, commit=True):
        scoped_revocations.append((user_id, user_agent, ip_address, commit))
        return 1

    async def fake_revoke_all_user_tokens(session, user_id, commit=True):
        global_revocations.append(user_id)
        return 1

    monkeypatch.setattr(AuthService, "revoke_user_session_tokens", fake_revoke_user_session_tokens, raising=False)
    monkeypatch.setattr(AuthService, "revoke_all_user_tokens", fake_revoke_all_user_tokens)

    result = asyncio.run(AuthService.get_user_by_refresh_token(session, "reused-refresh-token"))

    assert result is None
    assert scoped_revocations == [(42, "Chrome", "10.0.0.1", True)]
    assert global_revocations == []


def test_logout_rejects_refresh_token_owned_by_other_user(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_get_refresh_token_record(session, token):
        assert token == "foreign-refresh-token"
        return SimpleNamespace(user_id=999)

    async def fake_revoke_refresh_token(session, token, commit=True):
        raise AssertionError("logout should not revoke another user's refresh token")

    monkeypatch.setattr(
        "src.routes.auth.auth_service.AuthService.get_refresh_token_record",
        fake_get_refresh_token_record,
        raising=False,
    )
    monkeypatch.setattr(
        "src.routes.auth.auth_service.AuthService.revoke_refresh_token",
        fake_revoke_refresh_token,
    )

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            auth_routes.logout(
                token_data=schemas.RefreshTokenRequest(refresh_token="foreign-refresh-token"),
                session=object(),
                current_user=SimpleNamespace(id=1, is_active=True),
            )
        )

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "Refresh token does not belong to the current user"
