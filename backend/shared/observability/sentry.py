"""Shared Sentry initialization helpers."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

import sentry_sdk
from loguru import logger
from sentry_sdk.integrations.asyncio import AsyncioIntegration
from sentry_sdk.integrations.loguru import LoguruIntegration

from shared.core.errors import BaseAPIException

if TYPE_CHECKING:
    from sentry_sdk._types import Event, Hint, Log

# Exception types that are transport churn, not defects: aiormq/aio_pika raise
# these on every broker restart, graceful channel close, and reconnect, and each
# one opens its own Sentry group (``ChannelClosed`` alone produced four groups of
# ~650 events, all from ``_on_close_ok_frame`` — the *successful* close path).
# Broker/Postgres availability belongs to Prometheus alerting; an Issue per
# reconnect attempt only buries real faults.
_TRANSPORT_CHURN_EXCEPTIONS: frozenset[str] = frozenset(
    {
        "AMQPConnectionError",
        "CancelledError",
        "ChannelClosed",
        "ChannelInvalidStateError",
        # redis.exceptions.ConnectionError ("No connection available.", DNS
        # failures) and the stdlib subclasses below. Backend reachability is an
        # alerting concern, not a code defect.
        "ConnectionError",
        "ConnectionClosed",
        "ConnectionRefusedError",
        "ConnectionResetError",
    }
)

# Loggers whose ERROR records duplicate an exception event the SDK already
# captured from the same failure. FastStream logs a failing handler's traceback
# through its logger proxy *and* re-raises it, so without this filter every
# worker error reaches Sentry twice: once as the exception, once as a
# "Level 40 | faststream..." message group with a timestamp in the title (which
# also defeats grouping — 400+ single-event groups came from this).
_DUPLICATE_EVENT_LOGGERS: tuple[str, ...] = ("faststream",)


def _is_transport_churn(exc: BaseException) -> bool:
    """True for connection/channel lifecycle errors from the AMQP or DB drivers."""
    return any(klass.__name__ in _TRANSPORT_CHURN_EXCEPTIONS for klass in type(exc).__mro__)


def _is_expected_client_error(exc: BaseException) -> bool:
    """True for a domain 4xx that the RPC envelope already turned into a reply.

    ``AsyncioIntegration`` captures anything that propagates out of a task with
    ``handled=false``. cashews runs ``@cache(lock=True)`` bodies inside a task, so
    an ordinary ``raise ApiHTTPException(404, ...)`` from a cached flow is
    recorded as an unhandled error even though ``_read``/``_run`` catch it and
    return ``rpc_error``. 4xx means the caller asked for something that does not
    exist or is not allowed; only 5xx is ours.
    """
    if not isinstance(exc, BaseAPIException):
        return False
    status = getattr(exc, "status_code", 500)
    return isinstance(status, int) and 400 <= status < 500


def _before_send(event: Event, hint: Hint) -> Event | None:
    """Drop transport churn, already-handled 4xx, and duplicated worker logs."""
    if str(event.get("logger") or "").startswith(_DUPLICATE_EVENT_LOGGERS):
        return None
    exc_info = (hint or {}).get("exc_info")
    if exc_info:
        exc = exc_info[1]
        if _is_transport_churn(exc) or _is_expected_client_error(exc):
            return None
    return event


def _before_send_log(log: Log, hint: Hint) -> Log | None:
    """Drop Sentry Logs that mirror an exception event (see _DUPLICATE_EVENT_LOGGERS)."""
    name = log.get("attributes", {}).get("logger.name", "")
    if str(name).startswith(_DUPLICATE_EVENT_LOGGERS):
        return None
    return log


def _resolve_level(level: str | int) -> int:
    """Map a level name (e.g. ``"INFO"``) to its numeric logging level."""
    if isinstance(level, int):
        return level
    return getattr(logging, str(level).upper(), logging.INFO)


def setup_sentry(
    *,
    dsn: str | None,
    environment: str,
    traces_sample_rate: float,
    profiles_sample_rate: float,
    service_name: str | None = None,
    release: str | None = None,
    http_proxy: str | None = None,
    https_proxy: str | None = None,
    proxy_headers: dict[str, str] | None = None,
    enable_logs: bool = True,
    logs_level: str | int = "INFO",
    enable_metrics: bool = True,
) -> bool:
    """Initialize Sentry with tracing, structured logs, and metrics.

    When ``service_name`` is provided, a ``service`` tag is set on the global
    scope so that every event from this process is attributed to the service
    even though all backend processes share a single DSN.

    Observability surfaces wired here:

    - **Tracing** — ``traces_sample_rate`` plus the auto-enabled
      FastAPI/SQLAlchemy/Redis integrations. ``AsyncioIntegration`` is added
      explicitly so spans and errors from tasks spawned in the FastStream
      workers keep their context (it does not auto-enable).
    - **Logs** — when ``enable_logs`` is set, loguru records are forwarded to
      Sentry Logs at ``logs_level`` via :class:`LoguruIntegration`. Errors
      still become events (ERROR) and INFO records still become breadcrumbs.
    - **Metrics** — ``enable_metrics`` powers the experimental trace-metrics
      API exposed through :mod:`shared.observability.metrics`.
    - **Noise filtering** — ``_before_send``/``_before_send_log`` drop AMQP/DB
      transport churn, domain 4xx that the RPC envelope already answered, and
      FastStream's duplicate log of an exception it re-raises. Without them the
      signal-to-noise ratio makes the issue stream unusable (983 unresolved
      groups, of which fewer than a dozen were defects).
    """
    if not dsn:
        return False

    init_kwargs: dict[str, Any] = {
        "dsn": dsn,
        "environment": environment,
        "traces_sample_rate": traces_sample_rate,
        "profiles_sample_rate": profiles_sample_rate,
        "enable_logs": enable_logs,
        "enable_metrics": enable_metrics,
        # FastAPI/Starlette/SQLAlchemy/Redis auto-enable; Asyncio does not, and
        # the explicit Loguru integration lets us control the Sentry-logs level.
        "integrations": [
            AsyncioIntegration(),
            LoguruIntegration(sentry_logs_level=_resolve_level(logs_level)),
        ],
        "before_send": _before_send,
        "before_send_log": _before_send_log,
    }
    if release:
        init_kwargs["release"] = release
    if http_proxy:
        init_kwargs["http_proxy"] = http_proxy
    if https_proxy:
        init_kwargs["https_proxy"] = https_proxy
    if proxy_headers:
        init_kwargs["proxy_headers"] = proxy_headers

    sentry_sdk.init(**init_kwargs)

    if service_name:
        # Global scope tags apply to all events, including those raised in
        # background tasks/workers that run outside a request scope.
        sentry_sdk.get_global_scope().set_tag("service", service_name)

    logger.info(
        f"Sentry initialized (service={service_name}, sampling={traces_sample_rate}, "
        f"logs={enable_logs}, metrics={enable_metrics}, "
        f"http_proxy={http_proxy}, https_proxy={https_proxy})"
    )
    return True
