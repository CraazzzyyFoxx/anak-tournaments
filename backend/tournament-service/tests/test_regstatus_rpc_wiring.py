"""``rpc.tournament.regstatus_create``/``regstatus_update`` must forward every
custom-status field from the validated request body to ``status_catalog``.

Regression test: the handlers used to validate
``BalancerRegistrationStatusCreate``/``Update`` (which carry
``excludes_from_balancer``/``excludes_from_ready``) but never actually passed
either field to ``status_catalog.create_custom_status``/``update_custom_status``
-- so toggling "Excludes from balancer pool" or "Blocks Ready" in the admin UI
silently did nothing. Nothing else in the suite calls these handlers, so the
gap was invisible.
"""

from __future__ import annotations

import importlib
import os
import sys
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import patch

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "tournament-service"))

os.environ["DEBUG"] = "true"
os.environ.setdefault("PROJECT_URL", "http://localhost")
os.environ.setdefault("RABBITMQ_URL", "amqp://guest:guest@localhost:5672")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("POSTGRES_USER", "postgres")
os.environ.setdefault("POSTGRES_PASSWORD", "postgres")
os.environ.setdefault("POSTGRES_DB", "postgres")
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_PORT", "5432")
os.environ.setdefault("CHALLONGE_USERNAME", "test")
os.environ.setdefault("CHALLONGE_API_KEY", "test")

registration_admin = importlib.import_module("src.rpc.registration_admin")
helpers = importlib.import_module("src.rpc._helpers")

CREATED_AT = datetime(2026, 5, 1, 12, 30, tzinfo=UTC)

#: Grants exactly the "team update" gate the two subjects check on workspace 1.
IDENTITY = {
    "user_id": 7,
    "is_superuser": False,
    "is_active": True,
    "roles": [],
    "permissions": [],
    "workspaces": [
        {
            "workspace_id": 1,
            "rbac_roles": [],
            "rbac_permissions": [{"resource": "team", "action": "update"}],
        }
    ],
}


class _CapturingBroker:
    """Records the handler behind each subject instead of binding a queue."""

    def __init__(self) -> None:
        self.handlers: dict[str, object] = {}

    def subscriber(self, subject, *args, **kwargs):
        def register(fn):
            self.handlers[subject] = fn
            return fn

        return register


class _FakeSessionMaker:
    def __call__(self):
        return self

    async def __aenter__(self):
        return SimpleNamespace()

    async def __aexit__(self, *exc):
        return False


def _status_row(**overrides) -> SimpleNamespace:
    base = {
        "id": 42,
        "workspace_id": 1,
        "scope": "balancer",
        "slug": "injured",
        "kind": "custom",
        "icon_slug": None,
        "icon_color": None,
        "name": "Injured",
        "description": None,
        "excludes_from_balancer": False,
        "excludes_from_ready": False,
        "created_at": CREATED_AT,
        "updated_at": None,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


class RegstatusHandlersForwardExclusionFlags(IsolatedAsyncioTestCase):
    async def _invoke(self, subject: str, data: dict, *, service_fn, service_result):
        broker = _CapturingBroker()
        registration_admin.register(broker, SimpleNamespace(exception=lambda *a, **k: None))
        self.assertIn(subject, broker.handlers, "subject is not registered")

        calls: list[dict] = []

        async def stub(session, **kwargs):
            calls.append(kwargs)
            return service_result

        with (
            patch.object(helpers.db, "async_session_maker", _FakeSessionMaker()),
            patch.object(registration_admin.status_catalog.status_catalog_service, service_fn, stub),
        ):
            envelope = await broker.handlers[subject](data, None)
        return envelope, calls

    async def test_create_forwards_excludes_from_balancer_and_excludes_from_ready(self):
        envelope, calls = await self._invoke(
            "rpc.tournament.regstatus_create",
            {
                "identity": IDENTITY,
                "workspace_id": 1,
                "payload": {
                    "scope": "balancer",
                    "name": "Injured",
                    "excludes_from_balancer": True,
                    "excludes_from_ready": True,
                },
            },
            service_fn="create_custom_status",
            service_result=_status_row(excludes_from_balancer=True, excludes_from_ready=True),
        )

        self.assertTrue(envelope.get("ok"), envelope)
        self.assertEqual(1, len(calls))
        self.assertTrue(calls[0]["excludes_from_balancer"])
        self.assertTrue(calls[0]["excludes_from_ready"])

    async def test_create_defaults_both_flags_to_false(self):
        envelope, calls = await self._invoke(
            "rpc.tournament.regstatus_create",
            {
                "identity": IDENTITY,
                "workspace_id": 1,
                "payload": {"scope": "balancer", "name": "Standby"},
            },
            service_fn="create_custom_status",
            service_result=_status_row(slug="standby", name="Standby"),
        )

        self.assertTrue(envelope.get("ok"), envelope)
        self.assertEqual(1, len(calls))
        self.assertFalse(calls[0]["excludes_from_balancer"])
        self.assertFalse(calls[0]["excludes_from_ready"])

    async def test_update_forwards_excludes_from_balancer_and_excludes_from_ready(self):
        envelope, calls = await self._invoke(
            "rpc.tournament.regstatus_update",
            {
                "identity": IDENTITY,
                "workspace_id": 1,
                "status_id": 42,
                "payload": {
                    "excludes_from_balancer": True,
                    "excludes_from_ready": True,
                },
            },
            service_fn="update_custom_status",
            service_result=_status_row(excludes_from_balancer=True, excludes_from_ready=True),
        )

        self.assertTrue(envelope.get("ok"), envelope)
        self.assertEqual(1, len(calls))
        self.assertTrue(calls[0]["excludes_from_balancer"])
        self.assertTrue(calls[0]["excludes_from_ready"])

    async def test_update_omitting_flags_leaves_them_unset(self):
        """A PATCH that only renames the status must not clobber either flag --
        ``status_catalog.update_custom_status`` treats ``None`` as "leave it"."""
        envelope, calls = await self._invoke(
            "rpc.tournament.regstatus_update",
            {
                "identity": IDENTITY,
                "workspace_id": 1,
                "status_id": 42,
                "payload": {"name": "Renamed"},
            },
            service_fn="update_custom_status",
            service_result=_status_row(name="Renamed"),
        )

        self.assertTrue(envelope.get("ok"), envelope)
        self.assertEqual(1, len(calls))
        self.assertIsNone(calls[0]["excludes_from_balancer"])
        self.assertIsNone(calls[0]["excludes_from_ready"])
