"""Every dead-lettering queue a stats process consumes must have a declared DLQ.

The queue arguments name a dead-letter exchange and routing key, but RabbitMQ
does not create the target: an expired message routed to `dlx` with a routing key
nothing is bound to is discarded silently. That is how an ingest job could time
out on its 5-minute TTL and vanish, leaving its IngestJob on "Queued"
with nothing to inspect. These tests fail when a new dead-lettering subscriber is
added without a DLQ the owning process (or discipline module) declares.
"""

from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "stats-service"))

os.environ["DEBUG"] = "true"

rpc = importlib.import_module("serve_rpc")
worker = importlib.import_module("serve_worker")
collector_jobs = importlib.import_module("shared.disciplines.overwatch.collector.jobs")


def _dead_letter_routing_keys(process) -> set[str]:
    keys: set[str] = set()
    for subscriber in process.broker.subscribers:
        queue = getattr(subscriber, "queue", None)
        routing_key = (getattr(queue, "arguments", None) or {}).get("x-dead-letter-routing-key")
        if routing_key:
            keys.add(routing_key)
    return keys


def test_the_rpc_process_consumes_no_dead_lettering_queue() -> None:
    assert _dead_letter_routing_keys(rpc) == set()
    assert not hasattr(rpc, "_OWNED_DLQS")


def test_every_dead_lettering_worker_subscriber_has_a_declared_dlq() -> None:
    declared = {dlq.name for dlq in worker._OWNED_DLQS} | {dlq.name for dlq in collector_jobs.OWNED_DLQS}

    assert _dead_letter_routing_keys(worker) <= declared


def test_owned_dlqs_are_durable_and_not_orphaned() -> None:
    routing_keys = _dead_letter_routing_keys(worker)

    for dlq in (*worker._OWNED_DLQS, *collector_jobs.OWNED_DLQS):
        assert dlq.durable, f"{dlq.name} must survive a broker restart"
        assert dlq.name in routing_keys, f"{dlq.name} is declared but no subscriber dead-letters to it"


def test_every_selected_ingest_queue_has_its_dlq_and_no_other_does() -> None:
    ingest = {dlq.name for dlq in worker._OWNED_DLQS if dlq.name.startswith("stats.ingest.")}

    assert ingest == {f"stats.ingest.{spec.code}.dlq" for spec in worker.SELECTED}
    assert not [dlq for dlq in worker._OWNED_DLQS if dlq.name == "process_match_log.dlq"]


def test_the_worker_declares_its_dlqs_at_startup_and_the_module_declares_its_own(monkeypatch) -> None:
    declared: list[str] = []

    async def declare(_broker, queue) -> None:
        declared.append(queue.name)

    broker = SimpleNamespace()
    monkeypatch.setattr(collector_jobs, "declare_dead_letter_queue", declare)
    monkeypatch.setattr(collector_jobs.tasks, "rank_client", SimpleNamespace(start=AsyncMock()))
    monkeypatch.setattr(collector_jobs.scheduler, "start_scheduler", lambda: None)
    monkeypatch.setattr(collector_jobs.runtime, "_broker", broker)

    import asyncio

    asyncio.run(
        collector_jobs.start_jobs(
            session_factory=object(), redis=object(), logger=SimpleNamespace(info=lambda *_: None)
        )
    )

    assert declared == [dlq.name for dlq in collector_jobs.OWNED_DLQS]
    assert {"rank_fetch.dlq", "rank_fetch_priority.dlq"} <= set(declared)


@pytest.mark.parametrize("code", ["overwatch", "lol"])
def test_ingest_queue_and_dlq_follow_one_convention(code: str) -> None:
    messaging = importlib.import_module("shared.messaging.config")
    queue, dlq = messaging.ingest_queue(code), messaging.ingest_dlq(code)

    assert queue.name == f"stats.ingest.{code}" and queue.durable
    assert queue.arguments["x-dead-letter-exchange"] == "dlx"
    assert queue.arguments["x-dead-letter-routing-key"] == dlq.name == f"stats.ingest.{code}.dlq"
    assert queue.arguments["x-message-ttl"] == 300000
