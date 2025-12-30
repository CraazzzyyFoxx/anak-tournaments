from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse
from starlette.requests import Request

from src.core.config import settings
from src.core.db import init_db
from src.core.logging import logger
from src.routes import router
from src.middlewares.exception import ExceptionMiddleware
from src.middlewares.time import TimeMiddleware


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events"""
    logger.info(f"Starting {settings.PROJECT_NAME} - Auth Service...")
    logger.info(f"Environment: {settings.ENVIRONMENT}")
    logger.info(f"Port: {settings.PORT}")
    
    # Initialize database connection
    await init_db()
    logger.success("Database connection established")
    
    yield
    
    logger.info(f"Shutting down {settings.PROJECT_NAME}...")


app = FastAPI(
    title=settings.PROJECT_NAME,
    default_response_class=ORJSONResponse,
    version="1.0.0",
    lifespan=lifespan,
    root_path="/api/auth"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=(
        settings.ALLOWED_ORIGINS if settings.ALLOWED_ORIGINS else ["*"]
    ),
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "PATCH", "PUT"],
    allow_headers=["*"],
)
app.add_middleware(ExceptionMiddleware)
app.add_middleware(TimeMiddleware)


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
