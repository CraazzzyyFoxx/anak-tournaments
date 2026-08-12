"""The admin RPC return path: every handler must hand the broker plain JSON.

``_run`` wraps whatever ``op`` returns in ``rpc_ok`` and does **not** serialize it,
which its docstring says outright ("op returns raw (already dumped) data"). A
handler that returns a Pydantic model therefore looks fine all the way through the
subscriber and only dies when FastStream tries to encode the reply —
``TypeError: Type is not JSON serializable``. Nothing else in the suite reached a
handler's return value, so that failure mode was invisible.

This drives the four workspace-scoped admin list/detail subjects end to end with a
stubbed session and stubbed services, then does what the broker would do: dump the
envelope to JSON. As a side effect it also pins ``mode="json"`` — a `datetime` that
survived only ``model_dump()`` would fail here too.
"""

from __future__ import annotations

import importlib
import json
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

admin_misc = importlib.import_module("src.rpc.admin_misc")
helpers = importlib.import_module("src.rpc._helpers")
pagination = importlib.import_module("shared.core.pagination")
match_schemas = importlib.import_module("src.schemas.admin.matches")
reports_schemas = importlib.import_module("src.schemas.admin.encounter_reports")
log_processing = importlib.import_module("shared.models.ingestion.log_processing")

CREATED_AT = datetime(2026, 5, 1, 12, 30, tzinfo=UTC)

#: A gateway-shaped identity granting exactly the gate the four subjects check.
#: Deliberately not a superuser, so the real permission path runs.
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
            "rbac_permissions": [{"resource": "match", "action": "read"}],
        }
    ],
}


def _match_row(**kw) -> match_schemas.AdminMatchRow:
    base = {
        "id": 100,
        "encounter_id": 10,
        "encounter_name": "A vs B",
        "tournament_id": 3,
        "tournament_name": "Cup",
        "map_id": 8,
        "map_name": "Ilios",
        "home_team": {"id": 1, "name": "A"},
        "away_team": {"id": 2, "name": "B"},
        "home_score": 2,
        "away_score": 1,
        "time": 612.5,
        "log_name": "match.txt",
        "code": "ABC123",
        "created_at": CREATED_AT,
        "log_record": {
            "id": 77,
            "filename": "match.txt",
            "status": log_processing.LogProcessingStatus.done,
            "source": log_processing.LogProcessingSource.upload,
            "uploader_id": 5,
            "attempts": 1,
            "error_message": None,
            "created_at": CREATED_AT,
            "started_at": None,
            "finished_at": None,
        },
    }
    return match_schemas.AdminMatchRow(**{**base, **kw})


def _match_detail() -> match_schemas.AdminMatchDetail:
    return match_schemas.AdminMatchDetail(
        **_match_row().model_dump(),
        rounds=3,
        statistics_count=18,
        kill_feed_count=400,
        event_count=25,
    )


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
    """Stands in for ``db.async_session_maker`` — the services are stubbed, so the
    session only has to exist."""

    def __call__(self):
        return self

    async def __aenter__(self):
        return SimpleNamespace()

    async def __aexit__(self, *exc):
        return False


def _pydantic_models(value, path="data") -> list[str]:
    """Paths of every Pydantic model still embedded in an envelope."""
    if hasattr(value, "model_dump"):
        return [f"{path} ({type(value).__name__})"]
    if isinstance(value, dict):
        return [p for k, v in value.items() for p in _pydantic_models(v, f"{path}.{k}")]
    if isinstance(value, list | tuple):
        return [p for i, v in enumerate(value) for p in _pydantic_models(v, f"{path}[{i}]")]
    return []


class AdminRpcEnvelopesAreJson(IsolatedAsyncioTestCase):
    """One case per subject. Each asserts what the broker asserts: the reply
    encodes."""

    async def _invoke(self, subject: str, data: dict, **service_stubs) -> dict:
        broker = _CapturingBroker()
        admin_misc.register(broker, SimpleNamespace(exception=lambda *a, **k: None))
        self.assertIn(subject, broker.handlers, "subject is not registered")

        patches = [patch.object(helpers.db, "async_session_maker", _FakeSessionMaker())]
        for target, result in service_stubs.items():
            module, name = target.rsplit(".", 1)

            async def stub(*args, _result=result, **kwargs):
                return _result

            patches.append(patch.object(getattr(admin_misc, module), name, stub))

        for p in patches:
            self.enterContext(p)
        return await broker.handlers[subject](data, None)

    def _assert_encodes(self, envelope: dict) -> dict:
        self.assertTrue(envelope.get("ok"), envelope)
        leftovers = _pydantic_models(envelope["data"])
        self.assertEqual([], leftovers, "handler returned undumped Pydantic model(s)")
        # What FastStream does to the reply. Also proves ``mode="json"``: a raw
        # ``model_dump()`` leaves datetimes as objects and dies right here.
        json.dumps(envelope)
        return envelope["data"]

    async def test_matches_list(self):
        envelope = await self._invoke(
            "rpc.tournament.admin_matches_list",
            {"identity": IDENTITY, "query": {"workspace_id": ["1"]}},
            **{
                "matches_service.list_admin_matches": pagination.Paginated[match_schemas.AdminMatchRow](
                    page=1, per_page=10, total=1, results=[_match_row()]
                )
            },
        )
        data = self._assert_encodes(envelope)
        self.assertEqual(["page", "per_page", "total", "results"], list(data))
        self.assertEqual("2026-05-01T12:30:00Z", data["results"][0]["created_at"])

    async def test_match_get(self):
        envelope = await self._invoke(
            "rpc.tournament.admin_match_get",
            {"identity": IDENTITY, "id": 100, "query": {"workspace_id": ["1"]}},
            **{"matches_service.get_admin_match": _match_detail()},
        )
        data = self._assert_encodes(envelope)
        self.assertEqual(3, data["rounds"])

    async def test_encounter_reports_list(self):
        envelope = await self._invoke(
            "rpc.tournament.admin_encounter_reports_list",
            {"identity": IDENTITY, "query": {"workspace_id": ["1"]}},
            **{
                "reports_service.list_encounter_reports": pagination.Paginated[reports_schemas.EncounterReportsRow](
                    page=1, per_page=10, total=0, results=[]
                )
            },
        )
        data = self._assert_encodes(envelope)
        self.assertEqual(["page", "per_page", "total", "results"], list(data))

    async def test_encounter_reports_stats(self):
        envelope = await self._invoke(
            "rpc.tournament.admin_encounter_reports_stats",
            {"identity": IDENTITY, "query": {"workspace_id": ["1"]}},
            **{
                "reports_service.get_reports_stats": reports_schemas.EncounterReportsStats(
                    by_result_status={"disputed": 2}, mismatch_count=2, awaiting_second_count=1
                )
            },
        )
        data = self._assert_encodes(envelope)
        self.assertEqual({"disputed": 2}, data["by_result_status"])


class AdminRpcGatesStillApply(IsolatedAsyncioTestCase):
    """The dump fix must not have been bought by skipping the checks around it."""

    async def _envelope(self, subject: str, data: dict) -> dict:
        broker = _CapturingBroker()
        admin_misc.register(broker, SimpleNamespace(exception=lambda *a, **k: None))
        with patch.object(helpers.db, "async_session_maker", _FakeSessionMaker()):
            return await broker.handlers[subject](data, None)

    async def test_anonymous_caller_is_unauthorized_not_internal(self):
        """``_run`` maps ``MissingIdentityError``; ``_read`` would not, and the
        caller would see "internal error" for a missing token."""
        for subject in ("rpc.tournament.admin_matches_list", "rpc.tournament.admin_encounter_reports_list"):
            envelope = await self._envelope(subject, {"query": {"workspace_id": ["1"]}})
            self.assertEqual("unauthorized", envelope["error"]["code"], subject)

    async def test_a_workspace_the_caller_lacks_is_forbidden(self):
        envelope = await self._envelope(
            "rpc.tournament.admin_matches_list",
            {"identity": IDENTITY, "query": {"workspace_id": ["999"]}},
        )
        self.assertEqual("forbidden", envelope["error"]["code"])

    async def test_a_missing_workspace_id_is_rejected(self):
        """The lists span every tournament in a workspace, so there is nothing to
        fall back to — guessing one would cross the tenancy boundary."""
        envelope = await self._envelope("rpc.tournament.admin_matches_list", {"identity": IDENTITY, "query": {}})
        self.assertEqual("unprocessable", envelope["error"]["code"])
