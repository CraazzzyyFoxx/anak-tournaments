from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import ORJSONResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.requests import Request

from src import api
from src.core import config, db
from src.core.logging import logger
from src.middlewares.exception import ExceptionMiddleware
from src.middlewares.time import TimeMiddleware

from src.services.tournament import flows as tournament_flows
from src.services.achievement import flows as achievement_flows


@asynccontextmanager
async def lifespan(_: FastAPI):
    logger.info("Application... Online!")
    async with db.async_session_maker() as session:
        # for index in range(21, 36):
        #     await tournament_flows.get_analytics(session,  index)
        #
        await tournament_flows.get_analytics(session, 46)
        pass
        # await achievement_flows.calculate_achievements(session)
    yield


async def not_found(request: Request, _: Exception):
    return ORJSONResponse(status_code=404, content={"detail": [{"msg": "Not Found"}]})


exception_handlers = {404: not_found}

app = FastAPI(
    title=config.app.project_name,
    lifespan=lifespan,
    default_response_class=ORJSONResponse,
    debug=True if config.app.environment == "development" else False,
    docs_url="/docs" if config.app.environment == "development" else None,
    redoc_url="/redoc",
)
app.add_middleware(ExceptionMiddleware)
app.add_middleware(TimeMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.app.cors_origins if config.app.cors_origins else ["*"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "PATCH", "PUT"],
    allow_headers=["*"],
)

app.include_router(api.router)


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
