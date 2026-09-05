"""Shared Sentry initialization helpers."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

import sentry_sdk
from loguru import logger
from sentry_sdk.integrations import DidNotEnable
from sentry_sdk.integrations.asyncio import AsyncioIntegration
from sentry_sdk.integrations.loguru import LoguruIntegration

try:
    from sentry_sdk.integrations.otlp import OTLPIntegration

    _OTLP_AVAILABLE = True
except DidNotEnable:  # pragma: no cover - only when the OTLP HTTP exporter is absent
    _OTLP_AVAILABLE = False

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
        # asyncpg: server closed the socket mid-query (Postgres restart / failover).
        # SQLAlchemy wraps it in DBAPIError; _is_transport_churn walks ``orig``.
        "ConnectionDoesNotExistError",
    }
)

# Loggers whose ERROR records are never an actionable defect here.
#
# ``faststream`` logs a failing handler's traceback through its logger proxy *and*
# re-raises it, so without this filter every worker error reaches Sentry twice:
# once as the exception, once as a "Level 40 | faststream..." message group with a
# timestamp in the title (which also defeats grouping — 400+ single-event groups
# came from this).
#
# ``opentelemetry`` is the OTLP exporter failing to reach otel-collector. That is
# a tracing-pipeline availability problem, visible in the collector's own metrics
# and retried by the exporter itself; as Sentry issues it contributed ~800 events
# that no code change can address.
#
# ``aiormq``/``aio_pika`` log a refused broker connect at ERROR on every attempt
# while the broker is down, and the message embeds the exception rather than
# raising it — so it arrives as a log record and misses
# ``_TRANSPORT_CHURN_EXCEPTIONS`` even though ``AMQPConnectionError`` is already
# listed there. One stack restart produced 1248 events across two groups that way.
# This closes that gap; it is the same policy, not a new one.
#
# NB: ``asyncio`` is deliberately absent. "Task was destroyed but it is pending!"
# and "Event loop is closed" look like restart noise and are not: both mean a
# background task was never anchored or never cancelled, which is a real defect
# (see the fire-and-forget publishers fixed in ``realtime_publisher`` and
# ``balancer-service/serve.py``). Silencing that logger would have hidden them.
_NOISY_LOGGERS: tuple[str, ...] = ("faststream", "opentelemetry", "aiormq", "aio_pika")

# Reachability errors whose bare ``__name__`` is too generic to list above.
# ``redis.exceptions.TimeoutError`` is churn -- the same class of thing as the
# ``ConnectionError`` already listed, and one Redis blip produced 282 events
# across three groups -- but it shadows the stdlib/asyncio ``TimeoutError``, which
# is real signal about a slow dependency. Only the fully qualified name tells them
# apart. Deliberately NOT the whole ``redis.exceptions`` module: ``ResponseError``
# (WRONGTYPE) and ``DataError`` are defects in our own commands.
_CHURN_EXCEPTION_QUALNAMES: frozenset[str] = frozenset(
    {
        "redis.exceptions.BusyLoadingError",
        "redis.exceptions.ConnectionError",
        "redis.exceptions.TimeoutError",
        # asyncpg TLS upgrade calling set_result on a cancelled Future during
        # reconnect. Bare ``InvalidStateError`` is too generic to list above.
        "asyncio.exceptions.InvalidStateError",
    }
)


def _is_transport_churn(exc: BaseException) -> bool:
    """True for connection/channel lifecycle errors from the AMQP, Redis or DB drivers."""
    seen: set[int] = set()
    current: BaseException | None = exc
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        if any(
            klass.__name__ in _TRANSPORT_CHURN_EXCEPTIONS
            or f"{getattr(klass, '__module__', '')}.{klass.__name__}" in _CHURN_EXCEPTION_QUALNAMES
            for klass in type(current).__mro__
        ):
            return True
        orig = getattr(current, "orig", None)
        current = orig if isinstance(orig, BaseException) else (current.__cause__ or current.__context__)
    return False


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
    if str(event.get("logger") or "").startswith(_NOISY_LOGGERS):
        return None
    exc_info = (hint or {}).get("exc_info")
    if exc_info:
        exc = exc_info[1]
        if _is_transport_churn(exc) or _is_expected_client_error(exc):
            return None
    elif str(event.get("level") or "").lower() == "warning":
        # capture_message(..., level="warning") and Loguru warning records. Drift
        # checks and unfinished match logs are operator signal, not defects.
        return None
    return event


def _before_send_log(log: Log, hint: Hint) -> Log | None:
    """Drop Sentry Logs coming from the same loggers (see _NOISY_LOGGERS)."""
    name = log.get("attributes", {}).get("logger.name", "")
    if str(name).startswith(_NOISY_LOGGERS):
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

    - **Tracing** — spans come from OpenTelemetry
      (:mod:`shared.observability.tracing`), not from this SDK: the shared
      otel-collector fans the same OTLP stream out to Tempo *and* Sentry, so one
      trace spans the gateway, the broker hop and every service instead of the
      per-process transactions the SDK would emit on its own. ``traces_sample_rate``
      therefore stays at 0 in deployed environments — leaving it on would bill a
      second, disconnected copy of the same request. ``OTLPIntegration`` (with the
      SDK's own exporter *and* propagator disabled) only teaches this SDK to read
      the active OTel span, so errors, logs and metrics attach to that trace.
      ``AsyncioIntegration`` is added explicitly so errors from tasks spawned in
      the FastStream workers keep their context (it does not auto-enable).
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

    integrations: list[Any] = [
        AsyncioIntegration(),
        LoguruIntegration(
            sentry_logs_level=_resolve_level(logs_level),
            # ``event_format`` defaults to loguru's LOGURU_FORMAT and the SDK uses the
            # RENDERED line as the event's message, so every ERROR record arrived
            # titled ``2026-08-07 15:44:15.785 | ERROR | mod:fn:12 - ...``.
            #
            # Two costs, and they are NOT the same size -- measured, not assumed:
            # a record that carries a usable stacktrace still groups by that
            # stacktrace, so those issues held together (one had 510 events under a
            # single frozen title). What breaks there is only the title: it is
            # whichever occurrence Sentry saw last, so the group reads as a one-off
            # instant instead of naming the fault. But a MESSAGE-ONLY record has no
            # stacktrace to fall back on and groups by the message itself -- which
            # the timestamp makes unique per millisecond, fragmenting one fault into
            # a group per event (the 400+ single-event faststream groups noted
            # above). The bare message fixes both.
            #
            # Breadcrumbs keep the full format -- there the timestamp is the point.
            event_format="{message}",
        ),
    ]
    if _OTLP_AVAILABLE:
        # Trace linking only. Both side effects are off on purpose:
        # setup_otlp_traces_exporter would add a SECOND span processor shipping
        # every span straight to Sentry, duplicating what the otel-collector
        # already forwards; setup_propagator would swap the global W3C
        # traceparent propagator for Sentry's own, which is what carries trace
        # context across the gateway boundary and the RabbitMQ hop.
        integrations.append(OTLPIntegration(setup_otlp_traces_exporter=False, setup_propagator=False))

    init_kwargs: dict[str, Any] = {
        "dsn": dsn,
        "environment": environment,
        "traces_sample_rate": traces_sample_rate,
        "profiles_sample_rate": profiles_sample_rate,
        "enable_logs": enable_logs,
        "enable_metrics": enable_metrics,
        # FastAPI/Starlette/SQLAlchemy/Redis auto-enable; Asyncio does not, and
        # the explicit Loguru integration lets us control the Sentry-logs level.
        "integrations": integrations,
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
