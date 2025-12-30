from contextlib import asynccontextmanager
from datetime import datetime, UTC

from fastapi import FastAPI
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse

from shared.schemas import HealthCheckResponse
from src import routes
from src.core import config, db
from src.core.logging import logger
from src.middlewares.exception import ExceptionMiddleware
from src.middlewares.time import TimeMiddleware
from starlette.requests import Request


@asynccontextmanager
async def lifespan(_: FastAPI):
    async with db.async_session_maker() as session:
        pass
    logger.info(f"Starting {config.settings.project_name} - Parser Service...")
    logger.info(f"Environment: {config.settings.environment}")
    logger.info(f"Port: {config.settings.port}")
    yield


async def not_found(request: Request, _: Exception):
    return ORJSONResponse(status_code=404, content={"detail": [{"msg": "Not Found"}]})


exception_handlers = {404: not_found}

app = FastAPI(
    title=config.settings.project_name,
    lifespan=lifespan,
    default_response_class=ORJSONResponse,
    debug=True if config.settings.environment == "development" else False,
    docs_url="/docs",
    redoc_url="/redoc",
    root_path="/parser",
)
app.add_middleware(ExceptionMiddleware)
app.add_middleware(TimeMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.settings.cors_origins if config.settings.cors_origins else ["*"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "PATCH", "PUT"],
    allow_headers=["*"],
)

app.include_router(routes.router)

@app.get("/health")
async def health_check() -> HealthCheckResponse:
    """Health check endpoint"""
    return HealthCheckResponse(
        status="ok",
        service="parser-service",
        timestamp=int(datetime.now(UTC).timestamp()),
        version=config.settings.version,
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
