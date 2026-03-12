import asyncio
import os
import sys
from datetime import UTC, datetime
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

from src.routes import rbac as rbac_routes  # noqa: E402
from src.services import auth_service  # noqa: E402


def _role(
    role_id: int,
    name: str,
    *,
    permissions: list[SimpleNamespace] | None = None,
    is_system: bool = True,
) -> SimpleNamespace:
    now = datetime.now(UTC)
    return SimpleNamespace(
        id=role_id,
        name=name,
        description=f"{name} role",
        is_system=is_system,
        created_at=now,
        updated_at=None,
        permissions=permissions or [],
    )


def _user(user_id: int, email: str, *, roles: list[SimpleNamespace]) -> SimpleNamespace:
    now = datetime.now(UTC)
    return SimpleNamespace(
        id=user_id,
        email=email,
        username=email.split("@")[0],
        first_name="Ada",
        last_name="Lovelace",
        avatar_url=None,
        is_active=True,
        is_superuser=False,
        is_verified=True,
        created_at=now,
        updated_at=None,
        roles=roles,
    )


def test_list_auth_users_route_returns_user_summaries(monkeypatch: pytest.MonkeyPatch) -> None:
    admin_role = _role(1, "admin")
    users = [_user(7, "ada@example.com", roles=[admin_role])]

    async def fake_list_users_with_rbac(session, search=None, role_id=None, is_active=None, is_superuser=None):
        assert search == "ada"
        assert role_id == 1
        assert is_active is True
        assert is_superuser is False
        return users

    monkeypatch.setattr(
        "src.routes.rbac.auth_service.AuthService.list_users_with_rbac",
        fake_list_users_with_rbac,
    )

    response = asyncio.run(
        rbac_routes.list_auth_users(
            search="ada",
            role_id=1,
            is_active=True,
            is_superuser=False,
            session=object(),
            current_user=SimpleNamespace(is_superuser=True),
        )
    )

    assert len(response) == 1
    assert response[0].email == "ada@example.com"
    assert response[0].roles[0].name == "admin"


def test_require_permission_allows_user_with_matching_permission() -> None:
    current_user = SimpleNamespace(
        is_active=True,
        has_permission=lambda resource, action: resource == "role" and action == "read",
    )

    dependency = auth_service.require_permission("role", "read")

    response = asyncio.run(dependency(current_user=current_user))

    assert response is current_user


def test_require_permission_rejects_user_without_matching_permission() -> None:
    current_user = SimpleNamespace(
        is_active=True,
        has_permission=lambda _resource, _action: False,
    )

    dependency = auth_service.require_permission("role", "assign")

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(dependency(current_user=current_user))

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "Permission denied: role.assign required"


def test_get_auth_user_route_returns_effective_permissions(monkeypatch: pytest.MonkeyPatch) -> None:
    permissions = [
        SimpleNamespace(resource="team", action="read"),
        SimpleNamespace(resource="team", action="update"),
        SimpleNamespace(resource="*", action="*"),
    ]
    admin_role = _role(1, "admin", permissions=permissions)
    user = _user(9, "grace@example.com", roles=[admin_role])

    async def fake_get_user_with_rbac(session, user_id):
        assert user_id == 9
        return user

    monkeypatch.setattr(
        "src.routes.rbac.auth_service.AuthService.get_user_with_rbac",
        fake_get_user_with_rbac,
    )

    response = asyncio.run(
        rbac_routes.get_auth_user(
            user_id=9,
            session=object(),
            current_user=SimpleNamespace(is_superuser=True),
        )
    )

    assert response.email == "grace@example.com"
    assert response.roles[0].name == "admin"
    assert response.effective_permissions == ["admin.*", "team.read", "team.update"]


def test_get_auth_user_route_raises_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_get_user_with_rbac(session, user_id):
        assert user_id == 404
        return None

    monkeypatch.setattr(
        "src.routes.rbac.auth_service.AuthService.get_user_with_rbac",
        fake_get_user_with_rbac,
    )

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            rbac_routes.get_auth_user(
                user_id=404,
                session=object(),
                current_user=SimpleNamespace(is_superuser=True),
            )
        )

    assert exc_info.value.status_code == 404
    assert exc_info.value.detail == "User not found"


def test_remove_role_route_blocks_removing_last_admin_assignment(monkeypatch: pytest.MonkeyPatch) -> None:
    admin_role = _role(1, "admin")
    current_user = _user(1, "root@example.com", roles=[admin_role])
    current_user.is_superuser = True

    class _ScalarResult:
        def __init__(self, value):
            self._value = value

        def scalar_one_or_none(self):
            return self._value

    class _FakeSession:
        def __init__(self):
            self._values = [current_user, admin_role]
            self.commit_called = False

        async def execute(self, _query):
            return _ScalarResult(self._values.pop(0))

        async def commit(self):
            self.commit_called = True

    async def fake_count_users_with_role(_session, role_id):
        assert role_id == 1
        return 1

    monkeypatch.setattr("src.routes.rbac._count_users_with_role", fake_count_users_with_role, raising=False)

    session = _FakeSession()

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            rbac_routes.remove_role_from_user(
                data=SimpleNamespace(user_id=1, role_id=1),
                session=session,
                current_user=current_user,
            )
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Cannot remove the last admin role assignment"
    assert session.commit_called is False


def test_remove_role_route_allows_admin_removal_when_another_assignment_exists(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    admin_role = _role(1, "admin")
    current_user = _user(1, "root@example.com", roles=[admin_role])
    current_user.is_superuser = True

    class _ScalarResult:
        def __init__(self, value):
            self._value = value

        def scalar_one_or_none(self):
            return self._value

    class _FakeSession:
        def __init__(self):
            self._values = [current_user, admin_role]
            self.commit_called = False

        async def execute(self, _query):
            return _ScalarResult(self._values.pop(0))

        async def commit(self):
            self.commit_called = True

    async def fake_count_users_with_role(_session, role_id):
        assert role_id == 1
        return 2

    monkeypatch.setattr("src.routes.rbac._count_users_with_role", fake_count_users_with_role, raising=False)

    session = _FakeSession()

    asyncio.run(
        rbac_routes.remove_role_from_user(
            data=SimpleNamespace(user_id=1, role_id=1),
            session=session,
            current_user=current_user,
        )
    )

    assert session.commit_called is True
    assert current_user.roles == []


def test_update_role_route_rejects_system_roles() -> None:
    system_role = _role(11, "moderator", is_system=True)

    class _ScalarResult:
        def __init__(self, value):
            self._value = value

        def scalar_one_or_none(self):
            return self._value

    class _FakeSession:
        async def execute(self, _query):
            return _ScalarResult(system_role)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            rbac_routes.update_role(
                role_id=11,
                role_data=SimpleNamespace(name="moderator_v2", description=None, permission_ids=None),
                session=_FakeSession(),
                current_user=SimpleNamespace(is_superuser=True),
            )
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Cannot modify system roles"


def test_delete_role_route_rejects_system_roles() -> None:
    system_role = _role(12, "admin", is_system=True)

    class _ScalarResult:
        def __init__(self, value):
            self._value = value

        def scalar_one_or_none(self):
            return self._value

    class _FakeSession:
        async def execute(self, _query):
            return _ScalarResult(system_role)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            rbac_routes.delete_role(
                role_id=12,
                session=_FakeSession(),
                current_user=SimpleNamespace(is_superuser=True),
            )
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Cannot delete system roles"
