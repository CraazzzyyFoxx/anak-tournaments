"""Every queue in ``shared/messaging/config.py`` must have a consumer and a declared dead-letter queue.

Two wiring bugs with no runtime signal, caught statically the way ``test_rpc_route_parity`` catches orphan RPC
subjects:

- A queue nobody subscribes to. A topic-exchange binding only exists once a consumer declares the queue, so an
  outbox event routed there is dropped by RabbitMQ without a trace (``tournament.state.changed`` and
  ``tournament.registration.rejected`` ran like that for months).
- A DLQ nobody declares. The queue's ``x-dead-letter-routing-key`` points at a name RabbitMQ creates nothing for:
  an expired or rejected message vanishes instead of landing where an operator can see it (the analytics and
  balancer job queues, the discord RPC queues).

Text parsing on purpose: no broker, no RabbitMQ. A consumer is a constant inside ``subscriber(...)`` or passed as
``queue=...``; a declaration is the DLQ constant named anywhere in a service's non-test source (every service lists
the DLQs it owns in a tuple it feeds to ``declare_dead_letter_queue``).
"""

from __future__ import annotations

import ast
import re
from pathlib import Path
from unittest import TestCase

from shared.messaging.config import (
    CACHE_INVALIDATION_APP_QUEUE,
    CACHE_INVALIDATION_TOURNAMENT_QUEUE,
)

BACKEND = Path(__file__).resolve().parents[1]
CONFIG = BACKEND / "shared" / "messaging" / "config.py"

#: Where consumers and DLQ declarations may live. ``shared/messaging`` itself is excluded: naming a constant where
#: it is defined is not wiring it.
_SOURCE_ROOTS = (
    *(BACKEND.glob("*-service")),
    BACKEND / "shared",
)
_SKIP_PARTS = frozenset({"tests", "__pycache__", "messaging", "scripts", "migrations", "native", "assets"})


def _sources() -> list[str]:
    texts: list[str] = []
    for root in _SOURCE_ROOTS:
        for path in root.rglob("*.py"):
            if _SKIP_PARTS.intersection(path.relative_to(BACKEND).parts):
                continue
            texts.append(path.read_text(encoding="utf-8"))
    return texts


def _queue_constants() -> tuple[dict[str, str], dict[str, str]]:
    """``{QUEUE_CONST: dead-letter routing key}`` and ``{queue name: DLQ_CONST}`` from the config module's AST."""
    tree = ast.parse(CONFIG.read_text(encoding="utf-8"))
    dead_letter_of: dict[str, str] = {}
    dlq_const_by_name: dict[str, str] = {}
    for node in tree.body:
        if not isinstance(node, ast.Assign) or len(node.targets) != 1 or not isinstance(node.targets[0], ast.Name):
            continue
        call = node.value
        if not (isinstance(call, ast.Call) and isinstance(call.func, ast.Name) and call.func.id == "RabbitQueue"):
            continue
        const = node.targets[0].id
        queue_name = ast.literal_eval(call.args[0])
        if const.endswith("_DLQ"):
            dlq_const_by_name[queue_name] = const
            continue
        arguments = next((kw.value for kw in call.keywords if kw.arg == "arguments"), None)
        routing = None
        if isinstance(arguments, ast.Dict):
            for key, value in zip(arguments.keys, arguments.values, strict=True):
                if isinstance(key, ast.Constant) and key.value == "x-dead-letter-routing-key":
                    routing = ast.literal_eval(value)
        dead_letter_of[const] = routing or ""
    return dead_letter_of, dlq_const_by_name


class QueueWiringTests(TestCase):
    def setUp(self) -> None:
        self.sources = _sources()
        self.dead_letter_of, self.dlq_const_by_name = _queue_constants()
        self.assertGreater(len(self.dead_letter_of), 10, "config.py parsed into suspiciously few queues")

    def _any(self, pattern: re.Pattern[str]) -> bool:
        return any(pattern.search(text) for text in self.sources)

    def test_every_queue_has_a_consumer(self) -> None:
        orphans = [
            const for const in self.dead_letter_of if not self._any(re.compile(rf"(subscriber\(\s*|queue=){const}\b"))
        ]
        self.assertEqual(
            [],
            orphans,
            "Queues with no subscriber: events routed there are dropped silently. Add a consumer or delete the queue.",
        )

    def test_every_queue_dead_letters_into_a_declared_dlq(self) -> None:
        problems: list[str] = []
        for const, routing in self.dead_letter_of.items():
            dlq_const = self.dlq_const_by_name.get(routing)
            if dlq_const is None:
                problems.append(f"{const}: x-dead-letter-routing-key {routing!r} has no RabbitQueue constant")
                continue
            if not self._any(re.compile(rf"\b{dlq_const}\b")):
                problems.append(f"{const}: {dlq_const} is never passed to declare_dead_letter_queue by any service")
        self.assertEqual([], problems, "\n".join(problems))


def test_cache_invalidation_consumers_use_distinct_queues() -> None:
    # One queue per consuming service, never a shared one: two consumers on the
    # same queue would round-robin the messages between them, so each service
    # would drop half of its own cache invalidations. Same reason the
    # tournament.changed contour this replaced had two queues.
    assert CACHE_INVALIDATION_APP_QUEUE.name == "cache_invalidation_app_service"
    assert CACHE_INVALIDATION_TOURNAMENT_QUEUE.name == "cache_invalidation_tournament_service"
    assert CACHE_INVALIDATION_APP_QUEUE.name != CACHE_INVALIDATION_TOURNAMENT_QUEUE.name
    # `#`, not `*`: the routing key is `cache.invalidated.<scope_kind>.<scope_id>`,
    # which is one segment deeper than a single-wildcard binding matches.
    assert CACHE_INVALIDATION_APP_QUEUE.routing_key == "cache.invalidated.#"
    assert CACHE_INVALIDATION_TOURNAMENT_QUEUE.routing_key == "cache.invalidated.#"
