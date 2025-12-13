import time

from fastapi import FastAPI
from loguru import logger
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


class TimeMiddleware(BaseHTTPMiddleware):
    def __init__(
        self,
        app: FastAPI,
    ) -> None:
        super().__init__(app)

    async def dispatch(self, request: Request, call_next) -> Response:
        start_time = time.perf_counter()
        response = await call_next(request)
        process_time = time.perf_counter() - start_time
        response.headers["X-Process-Time"] = str(process_time)
        url_path = request.url.path
        if request.query_params:
            url_path += f"?{request.query_params}"

        if request.client is not None:
            logger.info(
                f'{request.client.host}:{request.client.port} - "{request.method} {url_path}" '
                f"{response.status_code} [process time: {int(process_time * 1000)} ms]"
            )
        else:
            logger.info(
                f'Unknown - "{request.method} {request.url.path}" '
                f"{response.status_code} [process time: {int(process_time * 1000)} ms]"
            )
        return response
