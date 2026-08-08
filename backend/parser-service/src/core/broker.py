"""Process-global worker broker accessor for the headless parser worker.

The HTTP service used a ``faststream.rabbit.fastapi.RabbitRouter`` that owned its
own broker (connected via the FastAPI lifespan); service-layer publishers fell
back to ``task_router.broker`` when no broker was threaded through. With the HTTP
service decommissioned the plain ``RabbitRouter`` has no broker, so the worker
registers its connected broker here once at startup. Publishers that aren't given
an explicit broker (the APScheduler rank tick, the admin "collect now" RPC, the
Challonge import recalculation enqueue, ...) resolve it through ``require_broker``
instead — never silently dropping a publish.
"""

from __future__ import annotations

from typing import Any

_worker_broker: Any | None = None


def set_worker_broker(broker: Any) -> None:
    """Register the worker's connected RabbitMQ broker (called from serve.py)."""
    global _worker_broker
    _worker_broker = broker


def require_broker(broker: Any | None = None) -> Any:
    """Return ``broker`` if given, else the registered worker broker.

    Raises a clear ``RuntimeError`` when neither is available so a misconfigured
    process fails loudly instead of silently swallowing the publish.
    """
    if broker is not None:
        return broker
    if _worker_broker is None:
        raise RuntimeError(
            "No RabbitMQ broker available: pass broker=... explicitly or call "
            "set_worker_broker(broker) at worker startup (serve.py)."
        )
    return _worker_broker


def optional_broker(broker: Any | None = None) -> Any | None:
    """``require_broker`` for callers that can work without one.

    Some consumers only want the broker as an optimisation -- the subscription
    resolver, for instance, batches role lookups over RPC when a broker exists
    and falls back to direct Discord REST when it does not. Those must not take
    down the request just because this process never registered a broker, and
    they must not spell that intent as a bare ``except Exception`` around
    ``require_broker`` either, which is how a *typo* in the surrounding code
    ends up looking like "no broker configured".
    """
    if broker is not None:
        return broker
    return _worker_broker
