"""Workspace-scoped per-user permission denies (negative RBAC).

Covers the admin CRUD surface added on top of the existing (Phase A/B)
``UserPermissionDeny.workspace_id`` column: ``permission_denies.add``/``.remove``
accept an optional ``workspace_id`` (``None`` = global deny, a concrete id =
scoped to that workspace only), and ``permission_denies.list`` surfaces the scope
of every deny row. The critical invariant under test is the NULL-safe scope match
(``UserPermissionDenyRepository.workspace_scope``): a global deny and a
workspace-scoped deny for the same permission must never be conflated by add's
idempotency check or by remove's delete, mirroring the ``COALESCE(workspace_id,
0)`` partial-unique index in ``shared.models.identity.rbac.UserPermissionDeny``.
"""

import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from shared.core.errors import BaseAPIException as HTTPException
from shared.repository import UserPermissionDenyRepository

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from src.services.rbac_admin import PermissionDenyService  # noqa: E402
from tests._fakes import FakeSessionCache as _NoopCache  # noqa: E402
from tests._fakes import make_root_actor as _current_user  # noqa: E402


def _service(cache: _NoopCache | None = None) -> PermissionDenyService:
    return PermissionDenyService(cache=cache or _NoopCache())


class _AllResult:
    """Fakes the ``Result`` object returned by ``session.execute(select(...))``.

    Covers the row-tuple ``.all()`` access of
    ``UserPermissionDenyRepository.list_with_permissions``, the
    ``unique().scalars().first()`` load ``BaseRepository.get`` performs, and
    ``rowcount`` — the DELETE-result attribute ``remove`` reads to tell a real
    removal from an idempotent no-op; 0 keeps these SQL-shape tests off the audit
    path they do not assert on.
    """

    rowcount = 0

    def __init__(self, rows: list[tuple]) -> None:
        self._rows = rows

    def all(self):
        return self._rows

    def unique(self):
        return self

    def scalars(self):
        return SimpleNamespace(first=lambda: self._rows, all=lambda: list(self._rows or []))


class _QueueSession:
    """Fakes a session whose ``execute``/``scalar`` calls pop from one FIFO of
    canned values, in the repository call order of the flow under test.

    ``execute`` results are wrapped in a ``Result`` (that is how the repositories
    read a row load); ``scalar`` returns the value as-is.
    """

    def __init__(self, results: list) -> None:
        self._results = list(results)
        self.added: list = []
        self.commit_called = False

    async def execute(self, _query):
        assert self._results, "unexpected execute() call"
        return _AllResult(self._results.pop(0))

    async def scalar(self, _query):
        assert self._results, "unexpected scalar() call"
        return self._results.pop(0)

    def add(self, obj) -> None:
        self.added.append(obj)

    async def commit(self) -> None:
        self.commit_called = True


class _CapturingSession:
    """Fakes a session whose ``execute(...)`` calls are all recorded, so the
    compiled SQL of a ``delete(...)`` statement can be inspected directly."""

    def __init__(self, list_rows: list[tuple] | None = None) -> None:
        self.executed: list = []
        self.commit_called = False
        self._list_result = _AllResult(list_rows or [])

    async def execute(self, query):
        self.executed.append(query)
        return self._list_result

    async def commit(self) -> None:
        self.commit_called = True


def _compiled(clause) -> str:
    return str(clause.compile(compile_kwargs={"literal_binds": True}))


# --- UserPermissionDenyRepository.workspace_scope: the NULL-safe scope predicate ---


def test_workspace_scope_filter_global_renders_is_null() -> None:
    clause = UserPermissionDenyRepository.workspace_scope(None)
    assert "IS NULL" in _compiled(clause)


def test_workspace_scope_filter_scoped_renders_equality() -> None:
    clause = UserPermissionDenyRepository.workspace_scope(42)
    compiled = _compiled(clause)
    assert "= 42" in compiled
    assert "IS NULL" not in compiled


# --- permission_denies.list: surfaces workspace_id per row ---


def test_list_user_denies_returns_workspace_id_per_row() -> None:
    global_permission = SimpleNamespace(
        id=1, name="account.avatar", resource="account", action="avatar", description=None
    )
    scoped_permission = SimpleNamespace(
        id=2,
        name="registration.self_register",
        resource="registration",
        action="self_register",
        description=None,
    )

    class _Session:
        async def execute(self, _query):
            return _AllResult([(global_permission, None), (scoped_permission, 7)])

    result = asyncio.run(_service().list(_Session(), _current_user(), 9))

    assert result == [
        {
            "permission_id": 1,
            "name": "account.avatar",
            "resource": "account",
            "action": "avatar",
            "description": None,
            "workspace_id": None,
        },
        {
            "permission_id": 2,
            "name": "registration.self_register",
            "resource": "registration",
            "action": "self_register",
            "description": None,
            "workspace_id": 7,
        },
    ]


# --- permission_denies.add: workspace-scoped create ---


def test_add_user_deny_scopes_new_row_to_workspace() -> None:
    user = SimpleNamespace(id=9, username="grace", email="grace@example.com")
    permission = SimpleNamespace(
        id=3,
        name="registration.self_register",
        resource="registration",
        action="self_register",
        description=None,
    )
    workspace = SimpleNamespace(id=7, name="Test Workspace")

    # Repository call order in add: user, permission and workspace via execute(),
    # then the existing-deny probe via scalar(), then the trailing list re-fetch.
    session = _QueueSession([user, permission, workspace, None, [(permission, 7)]])
    cache = _NoopCache()

    result = asyncio.run(_service(cache).add(session, _current_user(), 9, 3, workspace_id=7))

    assert session.commit_called is True
    assert cache.invalidated == [9]
    # One deny row plus its audit row.
    assert len(session.added) == 2
    created = session.added[0]
    assert created.user_id == 9
    assert created.permission_id == 3
    assert created.workspace_id == 7
    assert result == [
        {
            "permission_id": 3,
            "name": "registration.self_register",
            "resource": "registration",
            "action": "self_register",
            "description": None,
            "workspace_id": 7,
        }
    ]


def test_add_user_deny_defaults_to_global_scope() -> None:
    user = SimpleNamespace(id=9, username="grace", email="grace@example.com")
    permission = SimpleNamespace(id=4, name="account.social", resource="account", action="social", description=None)

    # No workspace lookup call is expected when workspace_id is omitted.
    session = _QueueSession([user, permission, None, [(permission, None)]])

    result = asyncio.run(_service().add(session, _current_user(), 9, 4))

    created = session.added[0]
    assert created.workspace_id is None
    assert result[0]["workspace_id"] is None


def test_add_user_deny_rejects_governance_permissions() -> None:
    """A deny on the RBAC surface itself could lock administration out of the
    system, so those resources are never deniable -- in any scope."""
    user = SimpleNamespace(id=9, username="grace", email="grace@example.com")
    permission = SimpleNamespace(id=5, name="role.update", resource="role", action="update", description=None)

    session = _QueueSession([user, permission])

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(_service().add(session, _current_user(), 9, 5, workspace_id=7))

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Cannot deny governance permission 'role.update'"
    assert session.added == []
    assert session.commit_called is False


def test_add_user_deny_raises_404_for_unknown_workspace() -> None:
    user = SimpleNamespace(id=9, username="grace", email="grace@example.com")
    permission = SimpleNamespace(
        id=3,
        name="registration.self_register",
        resource="registration",
        action="self_register",
        description=None,
    )

    session = _QueueSession([user, permission, None])

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(_service().add(session, _current_user(), 9, 3, workspace_id=999))

    assert exc_info.value.status_code == 404
    assert exc_info.value.detail == "Workspace not found"
    assert session.added == []


# --- permission_denies.remove: scoped delete never crosses scopes ---


def test_remove_user_deny_global_scope_matches_null_only() -> None:
    session = _CapturingSession()
    cache = _NoopCache()

    asyncio.run(_service(cache).remove(session, _current_user(), 9, 3, workspace_id=None))

    assert session.commit_called is True
    assert cache.invalidated == [9]
    delete_stmt = session.executed[0]
    compiled = _compiled(delete_stmt)
    assert "workspace_id IS NULL" in compiled
    assert "workspace_id = " not in compiled


def test_remove_user_deny_workspace_scope_matches_that_workspace_only() -> None:
    session = _CapturingSession()

    asyncio.run(_service().remove(session, _current_user(), 9, 3, workspace_id=7))

    assert session.commit_called is True
    delete_stmt = session.executed[0]
    compiled = _compiled(delete_stmt)
    assert "workspace_id = 7" in compiled
    assert "IS NULL" not in compiled
