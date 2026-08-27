"""Every dead-lettering queue this worker consumes must have a declared DLQ.

The queue arguments name a dead-letter exchange and routing key, but RabbitMQ
does not create the target: an expired message routed to `dlx` with a routing key
nothing is bound to is discarded silently. That is how a match-log job could time
out on its 5-minute TTL and vanish, leaving its LogProcessingRecord on "Queued"
with nothing to inspect. This test fails when a new dead-lettering subscriber is
added without extending ``serve._OWNED_DLQS``.
"""

from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "parser-service"))

os.environ["DEBUG"] = "true"

serve = importlib.import_module("serve")


def _dead_letter_routing_keys() -> set[str]:
    keys: set[str] = set()
    for subscriber in serve.broker.subscribers:
        queue = getattr(subscriber, "queue", None)
        routing_key = (getattr(queue, "arguments", None) or {}).get("x-dead-letter-routing-key")
        if routing_key:
            keys.add(routing_key)
    return keys


def test_every_dead_lettering_subscriber_has_a_declared_dlq() -> None:
    declared = {dlq.name for dlq in serve._OWNED_DLQS}

    assert _dead_letter_routing_keys() <= declared


def test_owned_dlqs_are_durable_and_not_orphaned() -> None:
    routing_keys = _dead_letter_routing_keys()

    for dlq in serve._OWNED_DLQS:
        assert dlq.durable, f"{dlq.name} must survive a broker restart"
        assert dlq.name in routing_keys, f"{dlq.name} is declared but no subscriber dead-letters to it"
