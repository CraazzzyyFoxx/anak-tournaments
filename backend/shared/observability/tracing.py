"""OpenTelemetry distributed tracing setup.

Configures OpenTelemetry with OTLP exporter for services like Jaeger.
Auto-instruments FastAPI, httpx, and SQLAlchemy for end-to-end tracing.
"""

from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.resources import Resource, SERVICE_NAME
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
from loguru import logger


def setup_tracing(
    service_name: str,
    otlp_endpoint: str | None = None,
    enabled: bool = True,
) -> None:
    """Configure OpenTelemetry with OTLP exporter.

    Args:
        service_name: Name of the service for trace identification
        otlp_endpoint: OTLP collector endpoint (e.g., "http://jaeger:4317")
        enabled: Whether to enable tracing (disable for local dev if needed)

    Example:
        ```python
        setup_tracing(
            service_name="app-service",
            otlp_endpoint="http://jaeger:4317",
            enabled=True,
        )
        ```
    """
    if not enabled:
        logger.info("🔍 OpenTelemetry tracing disabled")
        return

    if not otlp_endpoint:
        logger.warning("⚠️ OTLP endpoint not configured, tracing disabled")
        return

    try:
        # Create resource with service name
        resource = Resource(attributes={SERVICE_NAME: service_name})

        # Create tracer provider
        provider = TracerProvider(resource=resource)

        # Create OTLP exporter
        otlp_exporter = OTLPSpanExporter(endpoint=otlp_endpoint, insecure=True)

        # Add batch span processor
        provider.add_span_processor(BatchSpanProcessor(otlp_exporter))

        # Set as global default
        trace.set_tracer_provider(provider)

        # Auto-instrument httpx (for inter-service calls)
        HTTPXClientInstrumentor().instrument()

        logger.success(f"✅ OpenTelemetry tracing enabled (endpoint={otlp_endpoint})")

    except Exception as e:
        logger.error(f"❌ Failed to setup OpenTelemetry: {e}")


def instrument_fastapi(app) -> None:
    """Instrument FastAPI app for automatic tracing.

    Args:
        app: FastAPI application instance

    Example:
        ```python
        from fastapi import FastAPI
        from shared.observability import setup_tracing, instrument_fastapi

        app = FastAPI()
        setup_tracing("my-service", "http://jaeger:4317")
        instrument_fastapi(app)
        ```
    """
    try:
        FastAPIInstrumentor.instrument_app(app)
        logger.debug("✅ FastAPI instrumented for tracing")
    except Exception as e:
        logger.error(f"❌ Failed to instrument FastAPI: {e}")


def instrument_sqlalchemy(engine) -> None:
    """Instrument SQLAlchemy engine for automatic query tracing.

    Args:
        engine: SQLAlchemy engine instance

    Example:
        ```python
        from sqlalchemy import create_engine
        from shared.observability import instrument_sqlalchemy

        engine = create_engine(db_url)
        instrument_sqlalchemy(engine)
        ```
    """
    try:
        SQLAlchemyInstrumentor().instrument(engine=engine)
        logger.debug("✅ SQLAlchemy instrumented for tracing")
    except Exception as e:
        logger.error(f"❌ Failed to instrument SQLAlchemy: {e}")
