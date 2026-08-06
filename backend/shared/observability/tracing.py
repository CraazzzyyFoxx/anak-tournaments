"""OpenTelemetry distributed tracing setup."""

from __future__ import annotations

import os

from loguru import logger
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
from opentelemetry.sdk.resources import DEPLOYMENT_ENVIRONMENT, SERVICE_NAME, SERVICE_VERSION, Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.trace.sampling import ALWAYS_OFF, ALWAYS_ON, ParentBasedTraceIdRatio


def _build_sampler(sampler_name: str, sampler_arg: float):
    sampler_key = sampler_name.lower()
    if sampler_key == "always_on":
        return ALWAYS_ON
    if sampler_key == "always_off":
        return ALWAYS_OFF
    if sampler_key == "parentbased_traceidratio":
        return ParentBasedTraceIdRatio(sampler_arg)

    logger.warning(f"Unknown OTEL sampler '{sampler_name}', using parentbased_traceidratio")
    return ParentBasedTraceIdRatio(sampler_arg)


def setup_tracing(
    service_name: str,
    otlp_endpoint: str | None = None,
    enabled: bool = True,
    sampler_name: str = "parentbased_traceidratio",
    sampler_arg: float = 0.1,
    environment: str | None = None,
    release: str | None = None,
    engine: object | None = None,
) -> None:
    """Configure OpenTelemetry with an OTLP exporter.

    ``environment`` and ``release`` are resource attributes, not decoration: the
    otel-collector forwards this stream to Sentry as well as Tempo, and Sentry
    derives an event's environment from ``deployment.environment`` and its
    release from ``service.version``. Without them every span lands in Sentry
    unassigned, so production and local traces share one bucket. The gateway
    sets the same two attributes (gateway/internal/tracing/tracing.go).

    ``engine`` is an optional SQLAlchemy ``Engine``/``AsyncEngine`` to wrap for
    query spans (see :func:`instrument_sqlalchemy`); passing it here, rather
    than calling that function separately, keeps it behind the same
    ``enabled``/``otlp_endpoint`` guard as every other instrumentor below
    instead of registering listeners that end up nowhere when tracing is off.
    """
    if not enabled:
        logger.info("OpenTelemetry tracing disabled")
        return

    if not otlp_endpoint:
        logger.warning("OTLP endpoint not configured, tracing disabled")
        return

    try:
        current_provider = trace.get_tracer_provider()
        if not isinstance(current_provider, TracerProvider):
            attributes: dict[str, str] = {SERVICE_NAME: service_name}
            if environment:
                attributes[DEPLOYMENT_ENVIRONMENT] = environment
            if release:
                attributes[SERVICE_VERSION] = release
            provider = TracerProvider(
                resource=Resource(attributes=attributes),
                sampler=_build_sampler(sampler_name, sampler_arg),
            )
            provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=otlp_endpoint, insecure=True)))
            trace.set_tracer_provider(provider)

        # opentelemetry-instrumentation-httpx defaults to the OLD stable HTTP
        # semconv (`http.url`, `http.method`). Sentry's OTLP ingest builds a
        # span's description and low-cardinality name from the NEW semconv
        # (`url.full`, `http.request.method`) instead, so without this every
        # http.client span reaches Sentry with description "(no value)" and
        # every un-parented call collapses into one generic "GET" transaction.
        # "dup" emits both attribute sets, so Tempo/the Grafana Tracing
        # dashboard (built on the old names) sees no change.
        os.environ.setdefault("OTEL_SEMCONV_STABILITY_OPT_IN", "http/dup")
        if not getattr(HTTPXClientInstrumentor, "_is_instrumented_by_opentelemetry", False):
            HTTPXClientInstrumentor().instrument()

        if engine is not None:
            instrument_sqlalchemy(engine)

        logger.success(
            f"Tracing enabled for {service_name} (endpoint={otlp_endpoint}, sampler={sampler_name}:{sampler_arg})"
        )
    except Exception as exc:
        logger.error(f"Failed to setup OpenTelemetry: {exc}")


def instrument_sqlalchemy(engine) -> None:
    """Instrument a SQLAlchemy engine for automatic query tracing.

    Accepts a sync ``Engine`` or an ``AsyncEngine``. Every service here uses
    ``create_async_engine`` (asyncpg), and SQLAlchemy's ``AsyncEngine`` refuses
    event-listener registration outright (``listen()`` on it raises
    ``NotImplementedError`` — see ``AsyncEngine._no_async_engine_events``), so
    the instrumentor's ``before_cursor_execute``/etc. listeners must attach to
    the underlying sync engine, which is what ``EngineTracer`` actually needs.
    Passing the bare ``AsyncEngine`` would silently no-op (swallowed by the
    ``except`` below) instead of producing query spans.
    """
    sync_engine = getattr(engine, "sync_engine", engine)
    try:
        SQLAlchemyInstrumentor().instrument(engine=sync_engine)
        logger.debug("SQLAlchemy instrumented for tracing")
    except Exception as exc:
        logger.error(f"Failed to instrument SQLAlchemy: {exc}")
