"""Process-global worker broker accessor for the headless stats processes.

Each process registers its connected broker here once at startup. Publishers that aren't given
an explicit broker (the APScheduler rank tick, the admin "collect now" RPC, the
Challonge import recalculation enqueue, ...) resolve it through ``require_broker``
— never silently dropping a publish.

Re-exports ``shared.observability.broker``.
"""

from shared.observability.broker import optional_broker, require_broker, set_worker_broker

__all__ = ("set_worker_broker", "require_broker", "optional_broker")
