"""Process-global worker broker accessor for the headless parser worker.

The HTTP service used a ``faststream.rabbit.fastapi.RabbitRouter`` that owned its
own broker (connected via the FastAPI lifespan); service-layer publishers fell
back to ``task_router.broker`` when no broker was threaded through. With the HTTP
service decommissioned the plain ``RabbitRouter`` has no broker, so the worker
registers its connected broker here once at startup. Publishers that aren't given
an explicit broker (the APScheduler rank tick, the admin "collect now" RPC, the
Challonge import recalculation enqueue, ...) resolve it through ``require_broker``
instead — never silently dropping a publish.

Re-exports ``shared.observability.broker`` — the registry logic is identical
across every service's worker and lives there as the single source of truth.
"""

from shared.observability.broker import optional_broker, require_broker, set_worker_broker

__all__ = ("set_worker_broker", "require_broker", "optional_broker")
