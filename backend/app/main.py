from contextlib import asynccontextmanager

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
from src import api
from src.core import config
from src.core.logging import logger
from src.middlewares.exception import ExceptionMiddleware
from src.middlewares.time import TimeMiddleware
from starlette.requests import Request


@asynccontextmanager
async def lifespan(_: FastAPI):
    logger.info("Application... Online!")
    await cache.delete_match("fastapi:*")
    await cache.delete_match("backend:*")
    yield


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
app.include_router(api.router)
app.add_middleware(CacheDeleteMiddleware)
app.add_middleware(CacheEtagMiddleware)
app.add_middleware(CacheRequestControlMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=(
        config.settings.cors_origins if config.settings.cors_origins else ["*"]
    ),
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "PATCH", "PUT"],
    allow_headers=["*"],
)
app.add_middleware(ExceptionMiddleware)
app.add_middleware(TimeMiddleware)

cache.setup(config.settings.api_cache_url, prefix="fastapi:")
cache.setup(config.settings.backend_cache_url, prefix="backend:")


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(_: Request, exc: RequestValidationError):
    return ORJSONResponse(
        status_code=422,
        content={
            "detail": [
                {
                    "msg": jsonable_encoder(
                        exc.errors(), exclude={"url", "type", "ctx"}
                    ),
                    "code": "unprocessable_entity",
                }
            ]
        },
    )
