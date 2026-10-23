"""The evaluation-run list must serialize the run's UUID primary key.

``EvaluationRun`` is a UUID-keyed model; a ``str``-typed read schema rejected
the ORM's ``uuid.UUID`` and every list call answered 422. Driven through the
real subscriber; the query is stubbed, no DB.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from src.rpc import achievements as achievements_rpc
from tests._fakes import FakeBroker, active_identity, session_factory


def test_runs_reply_carries_the_uuid_id_as_a_string(monkeypatch: pytest.MonkeyPatch) -> None:
    run_id = uuid.uuid4()
    run = SimpleNamespace(
        id=run_id,
        workspace_id=5,
        trigger="manual",
        tournament_id=None,
        rules_evaluated=3,
        results_created=1,
        results_removed=0,
        started_at=datetime(2026, 10, 1, tzinfo=UTC),
        finished_at=None,
        status="failed",
        error_message="boom",
    )
    session = SimpleNamespace(execute=AsyncMock(return_value=SimpleNamespace(scalars=lambda: [run])))
    monkeypatch.setattr(achievements_rpc, "_SF", session_factory(session))

    broker = FakeBroker()
    achievements_rpc.register(broker, logging.getLogger("achievement-rpc-tests"))
    reply = asyncio.run(broker.handlers["rpc.stats.ach.runs"]({"identity": active_identity(), "workspace_id": 5}, None))

    assert reply["ok"], reply
    assert [row["id"] for row in reply["data"]] == [str(run_id)]
