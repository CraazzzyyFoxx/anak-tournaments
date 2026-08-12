"""The audit scope invariant for the CRUD-over-RPC engine.

One property matters more than every field on the row: the ``workspace_id`` the
journal records is the *same value* ``ensure_workspace_permission`` was checked
against. The tests below capture both and compare them, rather than asserting
each against a constant -- an implementation that re-resolved the workspace for
the audit row could pass two separate assertions while recording an action as
authorized in a workspace where it was not.

Runs under stdlib unittest with fake hooks and a fake session, matching
``shared/tests/test_rpc_crud.py``: no database, and the generic BaseRepository
path stays with the per-service integration tests.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any
from unittest import IsolatedAsyncioTestCase
from unittest.mock import patch

backend_root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(backend_root))

from pydantic import BaseModel  # noqa: E402

from shared.models.platform.audit import AuditLog  # noqa: E402
from shared.rpc import crud  # noqa: E402
from shared.rpc.crud import CrudDispatcher, EntityConfig  # noqa: E402

SUPERUSER: dict[str, Any] = {"user_id": 1, "is_superuser": True, "username": "root"}
# Member with only team.update in workspace 7 -- everything else is a 403.
MEMBER: dict[str, Any] = {
    "user_id": 2,
    "is_superuser": False,
    "roles": [],
    "permissions": [],
    "workspaces": [
        {
            "workspace_id": 7,
            "rbac_roles": [],
            "rbac_permissions": [{"resource": "team", "action": "update"}],
        }
    ],
}


class _FakeSession:
    """Collects what the dispatcher stages, so the audit rows can be inspected."""

    def __init__(self) -> None:
        self.added: list[Any] = []
        self.commits = 0

    def add(self, instance: Any) -> None:
        self.added.append(instance)

    async def commit(self) -> None:
        self.commits += 1

    async def flush(self) -> None:
        return None

    async def __aenter__(self) -> _FakeSession:
        return self

    async def __aexit__(self, *exc: object) -> bool:
        return False


class _Dummy:
    """Stand-in for a SQLAlchemy model (the service-hook path never touches it)."""


class _CreateSchema(BaseModel):
    name: str


class _UpdateSchema(BaseModel):
    name: str | None = None


class _DriftingWorkspace:
    """A resolver that answers differently on every call.

    Both ``resolve_ws_from_id`` and ``resolve_ws_for_create`` take
    ``(session, x)``, so one instance serves either slot. The drift is the point:
    an engine that resolved the workspace a second time for the audit row would
    record 97 while authorization ran against 7, and the equality assertions in
    this module would catch it.
    """

    def __init__(self, first: int = 7) -> None:
        self.first = first
        self.calls = 0

    async def __call__(self, session: Any, _: Any) -> int:
        self.calls += 1
        return self.first if self.calls == 1 else self.first + 90


async def _serialize(session: Any, obj: Any) -> dict[str, Any]:
    return {"id": getattr(obj, "id", 0), "name": getattr(obj, "name", None)}


async def _svc_create(session: Any, payload: _CreateSchema, data: dict[str, Any]) -> _Dummy:
    obj = _Dummy()
    obj.id = 42  # type: ignore[attr-defined]
    obj.name = payload.name  # type: ignore[attr-defined]
    return obj


async def _svc_update(session: Any, obj_id: int, payload: _UpdateSchema, data: dict[str, Any]) -> _Dummy:
    obj = _Dummy()
    obj.id = obj_id  # type: ignore[attr-defined]
    obj.name = payload.name  # type: ignore[attr-defined]
    return obj


async def _svc_delete(session: Any, obj_id: int, data: dict[str, Any]) -> None:
    return None


class _AuditCase(IsolatedAsyncioTestCase):
    """Base: one shared fake session plus a spy on the permission check."""

    def setUp(self) -> None:
        self.session = _FakeSession()
        self.authorized_ws: list[int] = []
        real = crud.ensure_workspace_permission

        def spy(user: Any, workspace_id: int, resource: str, action: str) -> None:
            self.authorized_ws.append(workspace_id)
            real(user, workspace_id, resource, action)

        patcher = patch.object(crud, "ensure_workspace_permission", spy)
        patcher.start()
        self.addCleanup(patcher.stop)

    def _dispatcher(self, *configs: EntityConfig) -> CrudDispatcher:
        return CrudDispatcher({cfg.entity: cfg for cfg in configs}, lambda: self.session)

    def _cfg(self, resolver: _DriftingWorkspace, entity: str = "team", **overrides: Any) -> EntityConfig:
        base: dict[str, Any] = {
            "entity": entity,
            "model": _Dummy,
            "permission_resource": "team",
            "serializer": _serialize,
            "create_schema": _CreateSchema,
            "update_schema": _UpdateSchema,
            "resolve_ws_from_id": resolver,
            "resolve_ws_for_create": resolver,
            "service_create": _svc_create,
            "service_update": _svc_update,
            "service_delete": _svc_delete,
            "actions": frozenset({"create", "get", "update", "delete"}),
        }
        base.update(overrides)
        return EntityConfig(**base)

    @property
    def rows(self) -> list[AuditLog]:
        return [row for row in self.session.added if isinstance(row, AuditLog)]


class AuditScopeTests(_AuditCase):
    """The recorded workspace is the authorized workspace, for all three verbs."""

    async def test_create_records_the_authorized_workspace(self) -> None:
        resolver = _DriftingWorkspace()
        dispatcher = self._dispatcher(self._cfg(resolver))

        res = await dispatcher.do_create({"entity": "team", "identity": SUPERUSER, "payload": {"name": "X"}})

        self.assertTrue(res["ok"])
        self.assertEqual([row.workspace_id for row in self.rows], self.authorized_ws)
        self.assertEqual(resolver.calls, 1)  # resolved once, reused -- never re-derived

    async def test_update_records_the_authorized_workspace(self) -> None:
        resolver = _DriftingWorkspace()
        dispatcher = self._dispatcher(self._cfg(resolver))

        res = await dispatcher.do_update({"entity": "team", "id": 5, "identity": SUPERUSER, "payload": {"name": "X"}})

        self.assertTrue(res["ok"])
        self.assertEqual([row.workspace_id for row in self.rows], self.authorized_ws)
        self.assertEqual(resolver.calls, 1)

    async def test_delete_records_the_authorized_workspace(self) -> None:
        resolver = _DriftingWorkspace()
        dispatcher = self._dispatcher(self._cfg(resolver))

        res = await dispatcher.do_delete({"entity": "team", "id": 5, "identity": SUPERUSER})

        self.assertTrue(res["ok"])
        self.assertEqual([row.workspace_id for row in self.rows], self.authorized_ws)
        self.assertEqual(resolver.calls, 1)

    async def test_every_verb_records_exactly_one_row(self) -> None:
        resolver = _DriftingWorkspace()
        dispatcher = self._dispatcher(self._cfg(resolver))

        await dispatcher.do_update({"entity": "team", "id": 5, "identity": SUPERUSER, "payload": {"name": "X"}})

        self.assertEqual(len(self.rows), 1)


class AuditActionTests(_AuditCase):
    """``action``/``entity_type`` name the entity, not the queue it arrived on."""

    async def test_one_dispatcher_two_entities_two_actions(self) -> None:
        # Production runs nine entities through a single admin queue, so a row
        # named after the dispatcher would collapse nine kinds of event into one.
        team = self._cfg(_DriftingWorkspace(), entity="team")
        stage_item = self._cfg(_DriftingWorkspace(), entity="stage_item")
        dispatcher = self._dispatcher(team, stage_item)

        await dispatcher.do_update({"entity": "team", "id": 5, "identity": SUPERUSER, "payload": {"name": "X"}})
        await dispatcher.do_update({"entity": "stage_item", "id": 6, "identity": SUPERUSER, "payload": {"name": "Y"}})

        self.assertEqual([row.action for row in self.rows], ["team.update", "stage_item.update"])
        self.assertEqual([row.entity_type for row in self.rows], ["team", "stage_item"])

    async def test_verbs_are_create_update_delete(self) -> None:
        dispatcher = self._dispatcher(self._cfg(_DriftingWorkspace()))

        await dispatcher.do_create({"entity": "team", "identity": SUPERUSER, "payload": {"name": "X"}})
        await dispatcher.do_update({"entity": "team", "id": 5, "identity": SUPERUSER, "payload": {"name": "Y"}})
        await dispatcher.do_delete({"entity": "team", "id": 5, "identity": SUPERUSER})

        self.assertEqual([row.action for row in self.rows], ["team.create", "team.update", "team.delete"])

    async def test_create_row_names_the_created_entity(self) -> None:
        dispatcher = self._dispatcher(self._cfg(_DriftingWorkspace()))

        await dispatcher.do_create({"entity": "team", "identity": SUPERUSER, "payload": {"name": "Squad"}})

        row = self.rows[0]
        self.assertEqual(row.entity_id, 42)  # the id the hook assigned
        self.assertEqual(row.entity_label, "Squad")
        self.assertEqual(row.source, "admin")
        self.assertEqual(row.actor_auth_user_id, 1)
        # Snapshotted from the envelope, not joined: the row must still name the
        # actor once the account behind actor_auth_user_id is gone (no FK).
        self.assertEqual(row.actor_label, "root")


class AuditFailureTests(_AuditCase):
    """A rejected mutation leaves no row: the journal records writes, not attempts."""

    async def test_permission_denied_writes_nothing(self) -> None:
        async def forbidden_delete(session: Any, obj_id: int, data: dict[str, Any]) -> None:
            raise AssertionError("hook must not run when permission is denied")

        dispatcher = self._dispatcher(self._cfg(_DriftingWorkspace(), service_delete=forbidden_delete))

        res = await dispatcher.do_delete({"entity": "team", "id": 5, "identity": MEMBER})

        self.assertEqual(res["error"]["code"], "forbidden")  # MEMBER has update only
        self.assertEqual(self.rows, [])

    async def test_invalid_payload_writes_nothing(self) -> None:
        dispatcher = self._dispatcher(self._cfg(_DriftingWorkspace()))

        res = await dispatcher.do_create({"entity": "team", "identity": SUPERUSER, "payload": {}})

        self.assertEqual(res["error"]["code"], "unprocessable")
        self.assertEqual(self.rows, [])

    async def test_missing_identity_writes_nothing(self) -> None:
        dispatcher = self._dispatcher(self._cfg(_DriftingWorkspace()))

        res = await dispatcher.do_update({"entity": "team", "id": 5, "payload": {"name": "X"}})

        self.assertEqual(res["error"]["code"], "unauthorized")
        self.assertEqual(self.rows, [])


class AuditPayloadTests(_AuditCase):
    """Only named domain fields reach the row -- never the raw request."""

    async def test_request_envelope_never_lands_in_the_diff(self) -> None:
        dispatcher = self._dispatcher(self._cfg(_DriftingWorkspace()))

        await dispatcher.do_update(
            {
                "entity": "team",
                "id": 5,
                "identity": SUPERUSER,
                "payload": {"name": "X"},
                "ip_address": "10.0.0.1",
                "user_agent": "curl/8",
                "tournament_id": 3,
            }
        )

        row = self.rows[0]
        # Only the keys the request actually set, and nothing from the envelope:
        # identity, path params and transport metadata stay out of the diff.
        self.assertEqual(set(row.after_json or {}), {"name"})
        self.assertEqual(row.ip_address, "10.0.0.1")
        self.assertEqual(row.user_agent, "curl/8")

    async def test_unset_update_fields_are_not_recorded_as_changes(self) -> None:
        class _WideUpdate(BaseModel):
            name: str | None = None
            description: str | None = None

        dispatcher = self._dispatcher(self._cfg(_DriftingWorkspace(), update_schema=_WideUpdate))

        await dispatcher.do_update({"entity": "team", "id": 5, "identity": SUPERUSER, "payload": {"name": "X"}})

        self.assertEqual(set(self.rows[0].after_json or {}), {"name"})


class JsonCoercionTests(IsolatedAsyncioTestCase):
    """The before/after values the generic path reads off an entity stay JSON-safe."""

    def test_scalars_pass_through(self) -> None:
        self.assertEqual(crud._json_safe(None), None)
        self.assertEqual(crud._json_safe(True), True)
        self.assertEqual(crud._json_safe(3), 3)
        self.assertEqual(crud._json_safe("x"), "x")

    def test_enum_becomes_its_value(self) -> None:
        from enum import Enum

        class _Status(str, Enum):
            OPEN = "open"

        self.assertEqual(crud._json_safe(_Status.OPEN), "open")

    def test_datetime_becomes_isoformat(self) -> None:
        from datetime import UTC, datetime

        self.assertEqual(
            crud._json_safe(datetime(2026, 8, 12, 10, 30, tzinfo=UTC)),
            "2026-08-12T10:30:00+00:00",
        )

    def test_decimal_keeps_precision_as_text(self) -> None:
        from decimal import Decimal

        # str, not float: an audited amount must read back exactly as written.
        self.assertEqual(crud._json_safe(Decimal("10.05")), "10.05")

    def test_nested_containers_are_coerced(self) -> None:
        from datetime import date

        self.assertEqual(
            crud._json_safe({"days": [date(2026, 1, 1)]}),
            {"days": ["2026-01-01"]},
        )

    def test_unknown_object_falls_back_to_text(self) -> None:
        class _Opaque:
            def __str__(self) -> str:
                return "opaque"

        self.assertEqual(crud._json_safe(_Opaque()), "opaque")

    def test_label_prefers_name_then_title_then_slug(self) -> None:
        obj = _Dummy()
        self.assertIsNone(crud._label(obj))
        obj.slug = "s"  # type: ignore[attr-defined]
        self.assertEqual(crud._label(obj), "s")
        obj.title = "t"  # type: ignore[attr-defined]
        self.assertEqual(crud._label(obj), "t")
        obj.name = "n"  # type: ignore[attr-defined]
        self.assertEqual(crud._label(obj), "n")

    def test_field_values_reads_off_the_object(self) -> None:
        obj = _Dummy()
        obj.name = "written"  # type: ignore[attr-defined]
        # A key the entity does not carry reads as None rather than exploding.
        self.assertEqual(crud._field_values(obj, ("name", "missing")), {"name": "written", "missing": None})
