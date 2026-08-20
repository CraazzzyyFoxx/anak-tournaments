from __future__ import annotations

import asyncio
import os
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace


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

import pytest  # noqa: E402

from src import models, schemas  # noqa: E402
from src.core import key_derivation  # noqa: E402
from src.core.config import settings  # noqa: E402
from src.services import api_keys as api_keys_module  # noqa: E402
from src.services.api_keys import api_keys  # noqa: E402


class _FakeExecuteResult:
    def __init__(self, scalar=None, scalars=None) -> None:
        self._scalar = scalar
        self._scalars = list(scalars or [])

    def scalar_one_or_none(self):
        return self._scalar

    def scalars(self):
        return SimpleNamespace(all=lambda: list(self._scalars))


class _FakeSession:
    def __init__(self, results: list[dict] | None = None) -> None:
        self._results = list(results or [])
        self.added = []
        self.flush_calls = 0
        self.commit_calls = 0
        self.refresh_calls = 0

    def add(self, row) -> None:
        self.added.append(row)

    async def execute(self, stmt):
        if not self._results:
            raise AssertionError("Unexpected execute() call")
        return _FakeExecuteResult(**self._results.pop(0))

    async def commit(self) -> None:
        self.commit_calls += 1

    async def flush(self) -> None:
        self.flush_calls += 1

    async def refresh(self, row) -> None:
        self.refresh_calls += 1
        row.id = 99
        row.created_at = datetime.now(UTC)
        row.updated_at = None


def _user(*, active: bool = True) -> models.AuthUser:
    return models.AuthUser(
        id=7,
        email="ada@example.com",
        username="ada",
        is_active=active,
        is_superuser=False,
        is_verified=True,
    )


def _workspace(*, active: bool = True) -> models.Workspace:
    return models.Workspace(id=11, slug="main", name="Main", is_active=active)


def _api_key_row(
    *,
    secret: str = "secret-token",
    secret_hash: str | None = None,
    revoked_at=None,
    expires_at=None,
    user: models.AuthUser | None = None,
    workspace: models.Workspace | None = None,
) -> models.ApiKey:
    return models.ApiKey(
        id=123,
        auth_user_id=7,
        workspace_id=11,
        public_id="publicid",
        secret_hash=secret_hash if secret_hash is not None else api_keys._hash_secret(secret),
        name="Balancer API",
        scopes_json=list(api_keys.DEFAULT_SCOPES),
        limits_json=dict(api_keys.DEFAULT_LIMITS),
        config_policy_json=dict(api_keys.DEFAULT_CONFIG_POLICY),
        expires_at=expires_at,
        revoked_at=revoked_at,
        last_used_at=None,
        created_at=datetime.now(UTC),
        updated_at=None,
        user=user if user is not None else _user(),
        workspace=workspace if workspace is not None else _workspace(),
    )


def test_create_api_key_returns_secret_once_and_stores_only_hash(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _FakeSession()
    tokens = iter(["publicid", "secret-token"])

    async def allow_manage(*args, **kwargs) -> None:
        return None

    monkeypatch.setattr(api_keys, "ensure_can_manage", allow_manage)
    monkeypatch.setattr(api_keys_module.secrets, "token_hex", lambda _bytes: next(tokens))

    response = asyncio.run(
        api_keys.create(
            session,
            user=_user(),
            payload=schemas.ApiKeyCreate(name="  Balancer API  ", workspace_id=11),
        )
    )

    stored = session.added[0]
    assert response.key == "aqt_sk_publicid_secret-token"
    assert stored.secret_hash == api_keys._hash_secret("secret-token")
    assert stored.secret_hash != "secret-token"
    assert stored.name == "Balancer API"
    assert "secret" not in response.api_key.model_dump()
    assert session.flush_calls == 1
    assert session.commit_calls == 1
    assert session.refresh_calls == 1


def test_is_api_key_recognizes_only_the_prefixed_form() -> None:
    assert api_keys.is_api_key("aqt_sk_publicid_secret-token") is True
    assert api_keys.is_api_key("eyJhbGciOiJIUzI1NiJ9.payload.sig") is False


@pytest.mark.parametrize(
    "raw_key",
    ["bad-format", "aqt_sk__secret", "aqt_sk_publicid_", "sk_aqt_publicid_secret", "aqt_sk_publicid_secret_extra"],
)
def test_split_key_rejects_malformed_keys(raw_key: str) -> None:
    assert api_keys._split_key(raw_key) is None


def test_verify_secret_accepts_the_legacy_raw_secret_hash() -> None:
    """Keys minted before domain separation stored ``HMAC(JWT_SECRET_KEY, secret)``.

    They must keep validating without a re-issue, while new writes use only the
    derived subkey.
    """
    legacy_hash = key_derivation.legacy_hmac_sha256_hex(settings.JWT_SECRET_KEY, "secret-token")

    assert legacy_hash != api_keys._hash_secret("secret-token")
    assert api_keys._verify_secret("secret-token", legacy_hash) is True
    assert api_keys._verify_secret("wrong", legacy_hash) is False


def test_validate_api_key_accepts_a_legacy_hashed_key(monkeypatch: pytest.MonkeyPatch) -> None:
    row = _api_key_row(secret_hash=key_derivation.legacy_hmac_sha256_hex(settings.JWT_SECRET_KEY, "secret-token"))
    session = _FakeSession([{"scalar": row}])

    async def allow_access(*args, **kwargs) -> bool:
        return True

    monkeypatch.setattr(api_keys, "_has_workspace_import_access", allow_access)

    payload = asyncio.run(api_keys.validate(session, "aqt_sk_publicid_secret-token"))

    assert payload is not None
    assert payload.api_key is not None
    assert payload.api_key.id == 123


def test_validate_api_key_returns_api_key_payload_and_updates_last_used(monkeypatch: pytest.MonkeyPatch) -> None:
    row = _api_key_row()
    session = _FakeSession([{"scalar": row}])

    async def allow_access(*args, **kwargs) -> bool:
        return True

    monkeypatch.setattr(api_keys, "_has_workspace_import_access", allow_access)

    payload = asyncio.run(api_keys.validate(session, "aqt_sk_publicid_secret-token"))

    assert payload is not None
    assert payload.credential_type == "api_key"
    assert payload.api_key is not None
    assert payload.api_key.id == 123
    assert payload.api_key.workspace_id == 11
    assert payload.api_key.scopes == ["balancer.jobs"]
    assert payload.workspaces[0].workspace_id == 11
    assert payload.workspaces[0].rbac_permissions == [{"resource": "team", "action": "create"}]
    assert row.last_used_at is not None
    assert session.commit_calls == 1


@pytest.mark.parametrize(
    ("row", "raw_key"),
    [
        (_api_key_row(secret="expected"), "bad-format"),
        (_api_key_row(secret="expected"), "aqt_sk_publicid_wrong"),
        (_api_key_row(revoked_at=datetime.now(UTC)), "aqt_sk_publicid_secret-token"),
        (_api_key_row(expires_at=datetime.now(UTC) - timedelta(seconds=1)), "aqt_sk_publicid_secret-token"),
        (_api_key_row(user=_user(active=False)), "aqt_sk_publicid_secret-token"),
        (_api_key_row(workspace=_workspace(active=False)), "aqt_sk_publicid_secret-token"),
    ],
)
def test_validate_api_key_rejects_invalid_revoked_expired_or_inactive(
    monkeypatch: pytest.MonkeyPatch,
    row: models.ApiKey,
    raw_key: str,
) -> None:
    session = _FakeSession([{"scalar": row}])

    async def allow_access(*args, **kwargs) -> bool:
        return True

    monkeypatch.setattr(api_keys, "_has_workspace_import_access", allow_access)

    payload = asyncio.run(api_keys.validate(session, raw_key))

    assert payload is None
    assert session.commit_calls == 0


def test_validate_api_key_rejects_when_owner_loses_workspace_access(monkeypatch: pytest.MonkeyPatch) -> None:
    row = _api_key_row()
    session = _FakeSession([{"scalar": row}])

    async def deny_access(*args, **kwargs) -> bool:
        return False

    monkeypatch.setattr(api_keys, "_has_workspace_import_access", deny_access)

    payload = asyncio.run(api_keys.validate(session, "aqt_sk_publicid_secret-token"))

    assert payload is None
    assert session.commit_calls == 0


@pytest.mark.parametrize(
    ("role_name", "permissions"),
    [
        ("admin", [{"resource": "team", "action": "create"}]),
        # Workspace owner holds ``admin.*``, stored as the wildcard pair.
        ("owner", [{"resource": "*", "action": "*"}]),
    ],
)
def test_workspace_admin_and_owner_manage_api_keys_via_rbac_alone(
    monkeypatch: pytest.MonkeyPatch,
    role_name: str,
    permissions: list[dict[str, str]],
) -> None:
    """Guards the removal of the legacy role-name shortcut in
    ``_has_workspace_import_access``: authorization must come from the
    workspace RBAC permission set, with no name-based fast path.
    """
    session = _FakeSession()

    async def get_workspace(_session, workspace_id: int) -> models.Workspace:
        assert workspace_id == 11
        return _workspace()

    async def get_member(_session, *, workspace_id: int, auth_user_id: int) -> models.WorkspaceMember:
        assert (workspace_id, auth_user_id) == (11, 7)
        return models.WorkspaceMember(workspace_id=workspace_id, player_id=42)

    async def workspace_rbac(_session, _user_id, _workspace_ids) -> dict:
        return {11: ([role_name], permissions)}

    monkeypatch.setattr(api_keys.workspaces, "get", get_workspace)
    monkeypatch.setattr(api_keys.members, "get_member", get_member)
    monkeypatch.setattr(api_keys.roles, "workspace_rbac_for_user", workspace_rbac)

    # Raises HTTPException(403) on denial; returning None is the pass signal.
    assert asyncio.run(api_keys.ensure_can_manage(session, user=_user(), workspace_id=11)) is None


def test_ensure_can_manage_denies_a_workspace_member_without_team_create(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _FakeSession()

    async def get_workspace(_session, _workspace_id: int) -> models.Workspace:
        return _workspace()

    async def get_member(_session, *, workspace_id: int, auth_user_id: int) -> models.WorkspaceMember:
        return models.WorkspaceMember(workspace_id=workspace_id, player_id=42)

    async def workspace_rbac(_session, _user_id, _workspace_ids) -> dict:
        return {11: (["viewer"], [{"resource": "team", "action": "read"}])}

    monkeypatch.setattr(api_keys.workspaces, "get", get_workspace)
    monkeypatch.setattr(api_keys.members, "get_member", get_member)
    monkeypatch.setattr(api_keys.roles, "workspace_rbac_for_user", workspace_rbac)

    with pytest.raises(api_keys_module.HTTPException) as exc_info:
        asyncio.run(api_keys.ensure_can_manage(session, user=_user(), workspace_id=11))

    assert exc_info.value.status_code == 403
    assert "team.create required" in exc_info.value.detail


@pytest.mark.parametrize(
    ("workspace", "expected_status"),
    [(None, 404), (_workspace(active=False), 403)],
)
def test_ensure_can_manage_rejects_missing_or_inactive_workspace(
    monkeypatch: pytest.MonkeyPatch,
    workspace: models.Workspace | None,
    expected_status: int,
) -> None:
    async def get_workspace(_session, _workspace_id: int) -> models.Workspace | None:
        return workspace

    monkeypatch.setattr(api_keys.workspaces, "get", get_workspace)

    with pytest.raises(api_keys_module.HTTPException) as exc_info:
        asyncio.run(api_keys.ensure_can_manage(_FakeSession(), user=_user(), workspace_id=11))

    assert exc_info.value.status_code == expected_status


def test_list_api_keys_requires_a_workspace() -> None:
    with pytest.raises(api_keys_module.HTTPException) as exc_info:
        asyncio.run(
            api_keys.list(_FakeSession(), user=_user(), params=schemas.ApiKeyListParams(workspace_id=None))
        )

    assert exc_info.value.status_code == 422
    assert exc_info.value.detail == "workspace_id is required"


def test_list_api_keys_returns_page_and_workspace_wide_status_counts(monkeypatch: pytest.MonkeyPatch) -> None:
    """The counts row must survive pagination and default missing buckets to 0."""
    session = _FakeSession()

    async def allow_manage(*args, **kwargs) -> None:
        return None

    async def list_page(_session, _params, *, auth_user_id: int, workspace_id: int, search: str | None):
        assert (auth_user_id, workspace_id, search) == (7, 11, None)
        return [_api_key_row()], 4

    async def status_counts(_session, *, auth_user_id: int, workspace_id: int, now) -> dict[str, int]:
        assert (auth_user_id, workspace_id) == (7, 11)
        # ``expired`` deliberately absent: the tally query omits empty buckets.
        return {"active": 3, "revoked": 1}

    monkeypatch.setattr(api_keys, "ensure_can_manage", allow_manage)
    monkeypatch.setattr(api_keys.keys, "list_page", list_page)
    monkeypatch.setattr(api_keys.keys, "status_counts", status_counts)

    result = asyncio.run(api_keys.list(session, user=_user(), params=schemas.ApiKeyListParams(workspace_id=11)))

    assert result["total"] == 4
    assert [row.id for row in result["results"]] == [123]
    counts = result["counts"]
    assert (counts.total, counts.active, counts.expired, counts.revoked) == (4, 3, 0, 1)
