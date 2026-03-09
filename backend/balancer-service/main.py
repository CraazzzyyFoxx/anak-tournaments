from contextlib import asynccontextmanager
from datetime import UTC, datetime

import sentry_sdk
from fastapi import FastAPI
from prometheus_fastapi_instrumentator import Instrumentator
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse
from src.core.config import config
from src.core.job_store import close_job_store
from src.middlewares.exception import ExceptionMiddleware
from src.views import router, task_router

from shared.clients import AuthClient
from shared.observability import (
    CorrelationIdMiddleware,
    TimeMiddleware,
    instrument_fastapi,
    setup_logging,
    setup_tracing,
)
from shared.schemas import HealthCheckResponse

# Setup structured logging
logger = setup_logging(
    service_name="balancer-service",
    log_level=config.log_level,
    logs_root_path=config.LOGS_ROOT_PATH,
    json_output=config.JSON_LOGGING,
)

# Create module-level singleton for auth client
auth_client = AuthClient(
    base_url=config.AUTH_SERVICE_URL,
    timeout=config.AUTH_SERVICE_TIMEOUT,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events"""
    # Initialize Sentry
    if config.SENTRY_DSN:
        sentry_sdk.init(
            dsn=config.SENTRY_DSN,
            traces_sample_rate=config.SENTRY_TRACES_SAMPLE_RATE,
            profiles_sample_rate=config.SENTRY_PROFILES_SAMPLE_RATE,
            environment=config.ENVIRONMENT,
            release=config.VERSION,
        )
        logger.info(f"✅ Sentry initialized (sampling={config.SENTRY_TRACES_SAMPLE_RATE})")

    # Setup OpenTelemetry tracing
    setup_tracing(
        service_name="balancer-service",
        otlp_endpoint=config.OTLP_ENDPOINT,
        enabled=config.TRACING_ENABLED,
    )

    await auth_client.start()  # Start connection pool
    logger.info(f"Starting {config.PROJECT_NAME} - Balancer Service...")
    logger.info(f"Environment: {config.ENVIRONMENT}")
    logger.info(f"Port: {config.PORT}")

    yield

    await auth_client.close()  # Close connection pool
    await close_job_store()
    logger.info("Shutting down Balancer Service...")


app = FastAPI(
    title=config.PROJECT_NAME,
    description=config.DESCRIPTION,
    default_response_class=ORJSONResponse,
    version=config.VERSION,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
    root_path="/api/balancer",
)

# Store auth_client on app state for dependency injection
app.state.auth_client = auth_client

# Instrument FastAPI for OpenTelemetry tracing
instrument_fastapi(app)

# Expose Prometheus /metrics endpoint
Instrumentator().instrument(app).expose(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=config.CORS_ALLOW_CREDENTIALS,
    allow_methods=config.CORS_ALLOW_METHODS,
    allow_headers=config.CORS_ALLOW_HEADERS,
)

# Observability middleware
app.add_middleware(ExceptionMiddleware)
app.add_middleware(TimeMiddleware)
app.add_middleware(CorrelationIdMiddleware)

app.include_router(router)
app.include_router(task_router)


@app.get("/health")
async def health_check() -> HealthCheckResponse:
    """Health check endpoint"""
    return HealthCheckResponse(
        status="ok",
        service="balancer-service",
        timestamp=int(datetime.now(UTC).timestamp()),
        version=config.VERSION,
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=config.PORT,
        log_config=None,
        access_log=False,
        # reload=config.ENVIRONMENT == "development"
    )
