from contextlib import asynccontextmanager

import sentry_sdk
from fastapi import FastAPI
from prometheus_fastapi_instrumentator import Instrumentator
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse
from starlette.requests import Request

from src.core.config import settings
from src.core.db import init_db
from src.core.redis import close_redis, init_redis
from src.routes import router
from src.middlewares.exception import ExceptionMiddleware

from shared.observability import (
    setup_logging,
    CorrelationIdMiddleware,
    TimeMiddleware,
    setup_tracing,
    instrument_fastapi,
)

# Setup structured logging (replaces old src.core.logging)
logger = setup_logging(
    service_name="auth-service",
    log_level=settings.log_level,
    logs_root_path=settings.logs_root_path,
    json_output=settings.json_logging,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events"""
    # Initialize Sentry
    if settings.sentry_dsn:
        sentry_sdk.init(
            dsn=settings.sentry_dsn,
            traces_sample_rate=settings.sentry_traces_sample_rate,
            profiles_sample_rate=settings.sentry_profiles_sample_rate,
            environment=settings.ENVIRONMENT,
        )

    # Setup OpenTelemetry tracing
    setup_tracing(
        service_name="auth-service",
        otlp_endpoint=settings.otlp_endpoint,
        enabled=settings.tracing_enabled,
    )

    logger.info(f"Starting {settings.PROJECT_NAME} - Auth Service...")
    logger.info(f"Environment: {settings.ENVIRONMENT}")
    logger.info(f"Port: {settings.PORT}")

    # Initialize database connection
    await init_db()
    logger.success("Database connection established")

    # Initialize Redis connection
    await init_redis()

    yield

    await close_redis()
    logger.info(f"Shutting down {settings.PROJECT_NAME}...")


app = FastAPI(
    title=settings.PROJECT_NAME,
    default_response_class=ORJSONResponse,
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
    root_path="/api/auth",
)

# Instrument FastAPI for OpenTelemetry tracing
instrument_fastapi(app)

# Expose Prometheus /metrics endpoint
Instrumentator().instrument(app).expose(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=(settings.ALLOWED_ORIGINS if settings.ALLOWED_ORIGINS else ["*"]),
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "PATCH", "PUT"],
    allow_headers=["*"],
)

# Observability middleware
app.add_middleware(ExceptionMiddleware)
app.add_middleware(TimeMiddleware)
app.add_middleware(CorrelationIdMiddleware)


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


# Include routers
app.include_router(router)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=settings.HOST,
        port=settings.PORT,
        log_config=None,
        access_log=False,
        # reload=config.ENVIRONMENT == "development"
    )
