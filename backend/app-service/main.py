from contextlib import asynccontextmanager
from datetime import datetime, UTC

from cashews import cache
from cashews.contrib.fastapi import (
    CacheDeleteMiddleware,
    CacheEtagMiddleware,
    CacheRequestControlMiddleware,
)
from fastapi import FastAPI
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse

import sentry_sdk
from prometheus_fastapi_instrumentator import Instrumentator

from shared.schemas import HealthCheckResponse
from shared.clients import AuthClient
from shared.observability import (
    setup_logging,
    CorrelationIdMiddleware,
    TimeMiddleware,
    setup_tracing,
    instrument_fastapi,
    check_postgres,
    check_redis,
)
from src.routes import router
from src.core import config, db
from src.middlewares.exception import ExceptionMiddleware
from starlette.requests import Request

# Setup structured logging (replaces old logging setup)
logger = setup_logging(
    service_name="app-service",
    log_level=config.settings.log_level,
    logs_root_path=config.settings.logs_root_path,
    json_output=config.settings.json_logging,
)

# Create module-level singleton for auth client
auth_client = AuthClient(
    base_url=config.settings.auth_service_url,
    timeout=config.settings.auth_service_timeout,
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Initialize Sentry with proper sampling
    if config.settings.sentry_dsn:
        sentry_sdk.init(
            dsn=config.settings.sentry_dsn,
            traces_sample_rate=config.settings.sentry_traces_sample_rate,
            profiles_sample_rate=config.settings.sentry_profiles_sample_rate,
            environment=config.settings.environment,
            release=config.settings.version,
        )
        logger.info(f"✅ Sentry initialized (sampling={config.settings.sentry_traces_sample_rate})")

    # Setup OpenTelemetry tracing
    setup_tracing(
        service_name="app-service",
        otlp_endpoint=config.settings.otlp_endpoint,
        enabled=config.settings.tracing_enabled,
    )

    await auth_client.start()  # Start connection pool
    logger.info("Application... Online!")
    await cache.delete_match("fastapi:*")
    await cache.delete_match("backend:*")
    yield
    await auth_client.close()  # Close connection pool


async def not_found(request: Request, _: Exception):
    return ORJSONResponse(status_code=404, content={"detail": [{"msg": "Not Found"}]})


# exception_handlers = {404: not_found}
exception_handlers = {}

app = FastAPI(
    title=config.settings.project_name,
    lifespan=lifespan,
    default_response_class=ORJSONResponse,
    debug=True if config.settings.environment == "development" else False,
    redoc_url="/redoc",
    exception_handlers=exception_handlers,
    root_path=config.settings.api_v1_str,
)

# Store auth_client on app state for dependency injection
app.state.auth_client = auth_client

# Instrument FastAPI for OpenTelemetry tracing
instrument_fastapi(app)

# Expose Prometheus /metrics endpoint
Instrumentator().instrument(app).expose(app)

app.include_router(router)
app.add_middleware(CacheDeleteMiddleware)
app.add_middleware(CacheEtagMiddleware)
app.add_middleware(CacheRequestControlMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=(config.settings.cors_origins if config.settings.cors_origins else ["*"]),
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "PATCH", "PUT"],
    allow_headers=["*"],
)

# Observability middleware (order matters: last added = first executed)
app.add_middleware(ExceptionMiddleware)  # Innermost
app.add_middleware(TimeMiddleware)  # Middle - logs request time
app.add_middleware(CorrelationIdMiddleware)  # Outermost - sets correlation ID first

cache.setup(config.settings.api_cache_url, prefix="fastapi:")
cache.setup(config.settings.backend_cache_url, prefix="backend:")


@app.get("/health")
async def health_check() -> HealthCheckResponse:
    """Enhanced health check endpoint with dependency checks"""
    deps = []

    # Check PostgreSQL
    deps.append(await check_postgres(db.async_session_maker))

    # Check Redis
    deps.append(await check_redis(str(config.settings.redis_url)))

    # Determine overall status
    overall_status = "ok"
    if any(d.status == "down" for d in deps):
        overall_status = "degraded"

    return HealthCheckResponse(
        status=overall_status,
        service="app-service",
        timestamp=int(datetime.now(UTC).timestamp()),
        version=config.settings.version,
        dependencies=deps,
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(_: Request, exc: RequestValidationError):
    return ORJSONResponse(
        status_code=422,
        content={
            "detail": [
                {
                    "msg": jsonable_encoder(exc.errors(), exclude={"url", "type", "ctx"}),
                    "code": "unprocessable_entity",
                }
            ]
        },
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=config.settings.host,
        port=config.settings.port,
        log_config=None,
        access_log=False,
        # reload=config.ENVIRONMENT == "development"
    )
