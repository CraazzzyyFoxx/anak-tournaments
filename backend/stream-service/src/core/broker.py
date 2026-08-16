"""Process-global worker broker accessor for the headless stream worker.

The RPC subscribers receive the broker from ``serve.py`` at registration time,
but the APScheduler poll tick does not: it runs outside any subscriber and still
has to publish the ``stream.updated`` realtime envelope. Rather than threading a
broker through the scheduler -> tick -> publisher chain (or, worse, letting the
publish silently no-op), the worker registers its connected broker here once at
startup and the tick resolves it through ``require_broker``.

Mirrors ``parser-service/src/core/broker.py``.
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

    The poll tick's Redis write is the source of truth; the realtime publish is a
    nice-to-have that only shortens the window before an open page notices. A
    process with no broker (a test, a one-shot script) must still be able to run
    the tick, and must not spell that intent as a bare ``except Exception``
    around ``require_broker`` — which is how a *typo* in the surrounding code
    ends up looking like "no broker configured".
    """
    if broker is not None:
        return broker
    return _worker_broker
