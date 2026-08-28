"""Platform audit rows written by identity-svc.

Two things are checked for every instrumented flow, and the second is the one
that matters: that exactly one ``AuditLog`` row is staged with the right actor,
entity and scope, and that it is staged **before** the flow's own ``commit()``.
An audit row added after the commit lands in a separate transaction, so a
rolled-back mutation keeps its trail and a committed one can lose it -- while a
test that merely counts rows stays green. Hence ``_EventSession``, which records
``add``/``flush``/``commit`` as an ordered log instead of a set of flags.

identity-svc is also the one worker whose ``actor_label`` is a real snapshot:
``serve.py::_with_active_user`` resolves ``current_user`` from the bearer token
before the flow runs, so the label is the live account name rather than an id
lifted off an envelope.
"""

import asyncio
import json
import secrets
import sys
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from shared.models.platform.audit import AuditLog  # noqa: E402
from src import models, schemas  # noqa: E402
from src.services.api_keys import ApiKeyService, api_keys  # noqa: E402
from src.services.rbac_admin import PermissionDenyService, RoleAdminService  # noqa: E402
from tests._fakes import make_auth_user as _api_actor  # noqa: E402

_SECRET = "secret-token"
_PUBLIC_ID = "publicid"


def _actor(user_id: int = 1) -> SimpleNamespace:
    """The RBAC operator, as ``_with_active_user`` hands it to a flow."""
    return SimpleNamespace(
        id=user_id,
        username="root",
        email="root@example.com",
        is_superuser=True,
        has_permission=lambda _resource, _action: True,
    )


def _api_key_row(*, revoked_at: datetime | None = None) -> models.ApiKey:
    return models.ApiKey(
        id=123,
        auth_user_id=7,
        workspace_id=11,
        public_id=_PUBLIC_ID,
        secret_hash=api_keys._hash_secret(_SECRET),
        name="Balancer API",
        scopes_json=["team.create"],
        limits_json=dict(ApiKeyService.DEFAULT_LIMITS),
        config_policy_json=dict(ApiKeyService.DEFAULT_CONFIG_POLICY),
        expires_at=None,
        revoked_at=revoked_at,
        last_used_at=None,
        created_at=datetime.now(UTC),
        updated_at=None,
    )


class _Result:
    """Covers the ``Result`` access shapes these flows use: a direct
    ``scalar_one_or_none()`` (the repository EXISTS probe), the repository's
    ``unique().scalars().first()`` row load, and the deny listing's row-tuple
    ``all()``."""

    def __init__(self, value) -> None:
        self._value = value

    def scalar_one_or_none(self):
        return self._value

    def unique(self):
        return self

    def scalars(self):
        return SimpleNamespace(first=lambda: self._value, all=lambda: list(self._value or []))

    def all(self):
        return list(self._value or [])


class _EventSession:
    """Fakes a session as an ordered event log so call ORDER can be asserted.

    ``execute``/``scalar`` pop from one FIFO of canned values, mirroring the
    ``_QueueSession`` pattern in ``test_rbac_user_deny_workspace.py``.
    """

    def __init__(self, results: list | None = None) -> None:
        self._results = list(results or [])
        self.events: list[tuple[str, object]] = []
        self._next_id = 77

    def add(self, row) -> None:
        self.events.append(("add", row))

    async def flush(self) -> None:
        self.events.append(("flush", None))
        # Stand in for the DB assigning a PK, so an audit row written after a
        # flush carries the same real ``entity_id`` it would in production.
        for kind, row in self.events:
            if kind == "add" and getattr(row, "id", None) is None:
                row.id = self._next_id
                self._next_id += 1

    async def commit(self) -> None:
        self.events.append(("commit", None))

    async def refresh(self, row) -> None:
        self.events.append(("refresh", None))
        if getattr(row, "created_at", None) is None:
            row.created_at = datetime.now(UTC)

    async def delete(self, row) -> None:
        self.events.append(("delete", row))

    async def execute(self, _query):
        if not self._results:
            raise AssertionError("unexpected execute() call")
        return _Result(self._results.pop(0))

    async def scalar(self, _query):
        if not self._results:
            raise AssertionError("unexpected scalar() call")
        return self._results.pop(0)


class _NoopCache:
    """Stands in for the ``session_cache`` singleton: these tests assert on the
    journal, not on Redis."""

    async def invalidate_rbac(self, _user_id: int) -> None:
        return None


def _audit_rows(session: _EventSession) -> list[AuditLog]:
    return [row for kind, row in session.events if kind == "add" and isinstance(row, AuditLog)]


def _one_audit_row(session: _EventSession) -> AuditLog:
    """The single audit row of a flow, asserted to precede the flow's commit."""
    rows = _audit_rows(session)
    assert len(rows) == 1, f"expected exactly one audit row, got {len(rows)}"

    kinds = [kind for kind, _row in session.events]
    assert "commit" in kinds, "flow never committed -- ordering is untested"
    audit_index = next(i for i, (_kind, row) in enumerate(session.events) if row is rows[0])
    assert audit_index < kinds.index("commit"), "audit row was staged after commit -- it is no longer atomic"
    return rows[0]


async def _allow_manage(*_args, **_kwargs) -> None:
    return None


# --- RBAC flows ---


def test_create_role_records_one_audit_row_before_commit() -> None:
    # Repository order in RoleAdminService.create: workspace EXISTS probe via
    # execute(), then the name-uniqueness probe via scalar().
    session = _EventSession(results=[True, None])
    role_data = SimpleNamespace(name="Referees", description="Match referees", workspace_id=7, permission_ids=None)

    role = asyncio.run(RoleAdminService(cache=_NoopCache()).create(session, _actor(), role_data))

    row = _one_audit_row(session)
    assert row.action == "role.create"
    assert row.source == "admin"
    assert row.entity_type == "role"
    assert row.entity_id == role.id
    assert row.entity_label == "Referees"
    assert row.workspace_id == 7
    assert row.actor_auth_user_id == 1
    assert row.actor_label == "root"
    assert row.after_json["name"] == "Referees"


def test_assign_role_records_audit_row_scoped_to_the_role_workspace() -> None:
    target = SimpleNamespace(id=9, username="grace", email="grace@example.com", roles=[])
    role = SimpleNamespace(id=5, name="Referees", workspace_id=7, permissions=[])

    # Repository order in assign_to_user: target user and role via execute(),
    # then the workspace-membership EXISTS probe via scalar().
    session = _EventSession(results=[target, role, True])

    asyncio.run(
        RoleAdminService(cache=_NoopCache()).assign_to_user(
            session, _actor(), SimpleNamespace(user_id=9, role_id=5)
        )
    )

    row = _one_audit_row(session)
    assert row.action == "role.assign"
    assert row.source == "admin"
    # The subject is the account whose power changed; the role is the payload.
    assert row.entity_type == "auth_user"
    assert row.entity_id == 9
    assert row.entity_label == "grace"
    # The workspace the role belongs to is the one authorization checked.
    assert row.workspace_id == 7
    assert row.actor_auth_user_id == 1
    assert row.actor_label == "root"
    assert row.after_json == {"role_id": 5, "role_name": "Referees", "workspace_id": 7}


def test_add_user_deny_records_audit_row_carrying_the_operator_reason() -> None:
    user = SimpleNamespace(id=9, username="grace", email="grace@example.com")
    permission = SimpleNamespace(
        id=3,
        name="registration.self_register",
        resource="registration",
        action="self_register",
        description=None,
    )

    # Repository order: user, permission and workspace via execute(), the
    # existing-deny probe via scalar(), then the trailing deny-list re-fetch.
    session = _EventSession(results=[user, permission, SimpleNamespace(id=7), None, []])

    asyncio.run(
        PermissionDenyService(cache=_NoopCache()).add(
            session,
            _actor(),
            9,
            3,
            reason="repeated abuse",
            workspace_id=7,
        )
    )

    row = _one_audit_row(session)
    assert row.action == "permission_deny.add"
    assert row.source == "admin"
    assert row.entity_type == "auth_user"
    assert row.entity_id == 9
    assert row.entity_label == "grace"
    assert row.workspace_id == 7
    assert row.actor_auth_user_id == 1
    assert row.actor_label == "root"
    assert row.reason == "repeated abuse"
    assert row.after_json["permission_name"] == "registration.self_register"


def test_add_user_deny_records_nothing_when_the_deny_already_exists() -> None:
    """Idempotent re-add: nothing changed, so the journal must stay silent."""
    user = SimpleNamespace(id=9, username="grace", email="grace@example.com")
    permission = SimpleNamespace(
        id=3,
        name="registration.self_register",
        resource="registration",
        action="self_register",
        description=None,
    )

    existing = SimpleNamespace(id=1)
    session = _EventSession(results=[user, permission, SimpleNamespace(id=7), existing, []])

    asyncio.run(PermissionDenyService(cache=_NoopCache()).add(session, _actor(), 9, 3, workspace_id=7))

    assert _audit_rows(session) == []


# --- API keys ---


def test_create_api_key_records_one_audit_row_before_commit(monkeypatch: pytest.MonkeyPatch) -> None:
    tokens = iter([_PUBLIC_ID, _SECRET])
    monkeypatch.setattr(api_keys, "ensure_can_manage", _allow_manage)
    monkeypatch.setattr(secrets, "token_hex", lambda _bytes: next(tokens))

    session = _EventSession()

    asyncio.run(
        api_keys.create(
            session,
            user=_api_actor(),
            payload=schemas.ApiKeyCreate(name="Balancer API", workspace_id=11),
        )
    )

    row = _one_audit_row(session)
    assert row.action == "api_key.create"
    assert row.source == "admin"
    assert row.entity_type == "api_key"
    assert row.entity_id == 77  # assigned by the repository flush, before the audit row
    assert row.entity_label == "Balancer API"
    assert row.workspace_id == 11
    assert row.actor_auth_user_id == 7
    assert row.actor_label == "ada"


def test_create_api_key_audit_row_never_carries_the_key_material(monkeypatch: pytest.MonkeyPatch) -> None:
    """The one field of this feature that could leak a credential."""
    tokens = iter([_PUBLIC_ID, _SECRET])
    monkeypatch.setattr(api_keys, "ensure_can_manage", _allow_manage)
    monkeypatch.setattr(secrets, "token_hex", lambda _bytes: next(tokens))

    session = _EventSession()

    response = asyncio.run(
        api_keys.create(
            session,
            user=_api_actor(),
            payload=schemas.ApiKeyCreate(name="Balancer API", workspace_id=11),
        )
    )

    stored = next(row for kind, row in session.events if kind == "add" and isinstance(row, models.ApiKey))
    audit = _one_audit_row(session)
    # json.dumps doubles as the JSONB-serializability check the column enforces.
    snapshot = json.dumps({"before": audit.before_json, "after": audit.after_json})

    assert _SECRET not in snapshot
    assert response.key not in snapshot
    assert stored.secret_hash not in snapshot
    assert "secret_hash" not in snapshot
    assert _PUBLIC_ID not in snapshot


def test_revoke_api_key_records_one_audit_row_before_commit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(api_keys, "ensure_can_manage", _allow_manage)

    session = _EventSession(results=[_api_key_row()])

    asyncio.run(api_keys.revoke(session, user=_api_actor(), api_key_id=123))

    row = _one_audit_row(session)
    assert row.action == "api_key.revoke"
    assert row.source == "admin"
    assert row.entity_type == "api_key"
    assert row.entity_id == 123
    assert row.entity_label == "Balancer API"
    assert row.workspace_id == 11
    assert row.actor_auth_user_id == 7
    assert row.actor_label == "ada"
    assert row.after_json["revoked_at"] is not None


def test_revoke_api_key_records_nothing_when_already_revoked(monkeypatch: pytest.MonkeyPatch) -> None:
    """The revoke is idempotent, so a repeat must not add a second row."""
    monkeypatch.setattr(api_keys, "ensure_can_manage", _allow_manage)

    session = _EventSession(results=[_api_key_row(revoked_at=datetime.now(UTC))])

    asyncio.run(api_keys.revoke(session, user=_api_actor(), api_key_id=123))

    assert _audit_rows(session) == []
    assert [kind for kind, _row in session.events] == []
