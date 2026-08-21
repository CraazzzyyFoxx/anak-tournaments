"""Process-global RabbitMQ broker registry for this worker.

Re-exports ``shared.observability.broker`` — the registry logic is identical
across every service's worker and lives there as the single source of truth.
The bot registers its connected broker here once (``DiscordRabbitGateway.start``)
and code that isn't handed an explicit broker (e.g. attachment uploads,
member-triggered subscription resync) resolves it through ``optional_broker``
instead of holding its own reference that could go stale across reconnects.
"""

from shared.observability.broker import optional_broker, require_broker, set_worker_broker

__all__ = ("set_worker_broker", "require_broker", "optional_broker")
