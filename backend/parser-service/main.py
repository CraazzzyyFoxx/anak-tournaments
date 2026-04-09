from contextlib import asynccontextmanager
from datetime import datetime, UTC

from fastapi import FastAPI
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

import sentry_sdk
from prometheus_fastapi_instrumentator import Instrumentator

from shared.schemas import HealthCheckResponse
from shared.clients import AuthClient, S3Client
from shared.observability import (
    setup_logging,
    CorrelationIdMiddleware,
    TimeMiddleware,
    setup_tracing,
    instrument_fastapi,
    check_postgres,
    check_redis,
    check_rabbitmq,
)
from src import routes
from src.core import config, db
from shared.core.middleware import ExceptionMiddleware, RequestSizeLimitMiddleware
from starlette.requests import Request

# Setup structured logging
logger = setup_logging(
    service_name="parser-service",
    log_level=config.settings.log_level,
    logs_root_path=config.settings.logs_root_path,
    json_output=config.settings.json_logging,
)

# Create module-level singletons for clients
auth_client = AuthClient(
    base_url=config.settings.auth_service_url,
    timeout=config.settings.auth_service_timeout,
)

s3_client = S3Client(
    access_key=config.settings.s3_access_key,
    secret_key=config.settings.s3_secret_key,
    endpoint_url=config.settings.s3_endpoint_url,
    bucket_name=config.settings.s3_bucket_name,
    public_url=config.settings.s3_public_url,
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Initialize Sentry
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
        service_name="parser-service",
        otlp_endpoint=config.settings.otlp_endpoint,
        enabled=config.settings.tracing_enabled,
    )

    await auth_client.start()
    await s3_client.start()
    async with db.async_session_maker() as session:
        pass
    logger.info(f"Starting {config.settings.project_name} - Parser Service...")
    logger.info(f"Environment: {config.settings.environment}")
    logger.info(f"Port: {config.settings.port}")
    yield
    await s3_client.close()
    await auth_client.close()


async def not_found(request: Request, _: Exception):
    return JSONResponse(status_code=404, content={"detail": [{"msg": "Not Found"}]})


exception_handlers = {404: not_found}

app = FastAPI(
    title=config.settings.project_name,
    lifespan=lifespan,
    debug=True if config.settings.environment == "development" else False,
    docs_url="/docs",
    redoc_url="/redoc",
    root_path="/api/parser",
    default_response_class=JSONResponse,
)

# Store clients on app state for dependency injection
app.state.auth_client = auth_client
app.state.s3 = s3_client

# Instrument FastAPI for OpenTelemetry tracing
instrument_fastapi(app)

# Expose Prometheus /metrics endpoint
Instrumentator().instrument(app).expose(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.settings.cors_origins if config.settings.cors_origins else ["*"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "PATCH", "PUT"],
    allow_headers=["*"],
)

# Observability middleware
app.add_middleware(RequestSizeLimitMiddleware, max_content_length=50 * 1024 * 1024)  # 50MB limit (log file uploads)
app.add_middleware(ExceptionMiddleware, is_development=config.settings.environment == "development")
app.add_middleware(TimeMiddleware)
app.add_middleware(CorrelationIdMiddleware)

app.include_router(routes.router)


@app.get("/health")
async def health_check() -> HealthCheckResponse:
    """Enhanced health check endpoint with dependency checks"""
    deps = []
    deps.append(await check_postgres(db.async_session_maker))
    deps.append(await check_redis(str(config.settings.redis_url)))
    deps.append(await check_rabbitmq(config.settings.rabbitmq_url))

    overall_status = "ok"
    if any(d.status == "down" for d in deps):
        overall_status = "degraded"

    return HealthCheckResponse(
        status=overall_status,
        service="parser-service",
        timestamp=int(datetime.now(UTC).timestamp()),
        version=config.settings.version,
        dependencies=deps,
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(_: Request, exc: RequestValidationError):
    return JSONResponse(
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
