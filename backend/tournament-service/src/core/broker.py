"""Process-global worker broker accessor for the headless tournament worker.

The plain ``RabbitRouter`` owns no broker, so the worker registers its connected
broker here once at startup. Publishers that aren't given an explicit broker
resolve it through ``require_broker``, which raises rather than silently
dropping a publish.

Re-exports ``shared.observability.broker``, the one registry every service's
worker shares.
"""

from shared.observability.broker import optional_broker, require_broker, set_worker_broker

__all__ = ("set_worker_broker", "require_broker", "optional_broker")
