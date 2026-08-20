"""Process-global worker broker accessor for the headless stream worker.

The RPC subscribers receive the broker from ``serve.py`` at registration time,
but the APScheduler poll tick does not: it runs outside any subscriber and still
has to publish the ``stream.updated`` realtime envelope. Rather than threading a
broker through the scheduler -> tick -> publisher chain (or, worse, letting the
publish silently no-op), the worker registers its connected broker here once at
startup and the tick resolves it through ``require_broker``.

Re-exports ``shared.observability.broker`` — the registry logic is identical
across every service's worker and lives there as the single source of truth.
"""

from shared.observability.broker import optional_broker, require_broker, set_worker_broker

__all__ = ("set_worker_broker", "require_broker", "optional_broker")
