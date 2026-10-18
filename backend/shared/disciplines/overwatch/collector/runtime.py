"""The process wiring the collector's hooks receive (``register_jobs``/``start_jobs``): DB sessions, Redis, the broker.

Module code never reaches into a service for these; the worker hands them over once and every task, scheduler tick and
admin handler reads them back here.
"""

from __future__ import annotations

from typing import Any

_session_factory: Any | None = None
_redis: Any | None = None
_broker: Any | None = None


def configure(*, session_factory: Any, redis: Any, broker: Any | None = None) -> None:
    global _session_factory, _redis, _broker
    _session_factory = session_factory
    _redis = redis
    if broker is not None:
        _broker = broker


def session_factory() -> Any:
    if _session_factory is None:
        raise RuntimeError("OverFast collector is not configured: the worker must call the module's jobs hooks first")
    return _session_factory


def redis() -> Any:
    if _redis is None:
        raise RuntimeError("OverFast collector is not configured: the worker must call the module's jobs hooks first")
    return _redis


def broker() -> Any | None:
    """The broker given to ``register_jobs``; ``None`` falls through to ``require_broker``'s process-global."""
    return _broker
