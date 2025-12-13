from contextlib import asynccontextmanager
from datetime import datetime, UTC

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse

from src.core.config import config
from src.core.logging import logger
from src.views import router
from src.middlewares.exception import ExceptionMiddleware
from src.middlewares.time import TimeMiddleware
from shared.schemas import HealthCheckResponse


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events"""
    logger.info(f"Starting {config.PROJECT_NAME} - Balancer Service...")
    logger.info(f"Environment: {config.ENVIRONMENT}")
    logger.info(f"Port: {config.PORT}")
    
    yield
    
    logger.info("Shutting down Balancer Service...")


app = FastAPI(
    title=config.PROJECT_NAME,
    description=config.DESCRIPTION,
    default_response_class=ORJSONResponse,
    version=config.VERSION,
    docs_url=config.DOCS_URL,
    redoc_url=config.REDOC_URL,
    openapi_url=config.OPENAPI_URL,
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=config.CORS_ALLOW_CREDENTIALS,
    allow_methods=config.CORS_ALLOW_METHODS,
    allow_headers=config.CORS_ALLOW_HEADERS,
)

app.add_middleware(ExceptionMiddleware)
app.add_middleware(TimeMiddleware)

app.include_router(router)


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
        # reload=config.ENVIRONMENT == "development"
    )
