from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import HTTPException, RequestValidationError
from fastapi.responses import ORJSONResponse
from loguru import logger
from pydantic import ValidationError
from starlette import status
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from src.core import config, errors


class ExceptionMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        try:
            response = await call_next(request)
        except RequestValidationError as e:
            if config.app.environment == "development":
                logger.exception("What!?")
            response = ORJSONResponse(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                content={
                    "detail": [
                        {
                            "msg": jsonable_encoder(e.errors(), exclude={"url", "type", "ctx"}),
                            "code": "unprocessable_entity",
                        }
                    ]
                },
            )
        except ValidationError as e:
            logger.exception("What!?")
            response = ORJSONResponse(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                content={
                    "detail": [
                        {
                            "msg": e.errors(include_url=False),
                            "code": "unprocessable_entity",
                        }
                    ]
                },
            )
        except errors.ApiHTTPException as e:
            response = ORJSONResponse(content={"detail": e.detail}, status_code=e.status_code)
        except HTTPException as e:
            response = ORJSONResponse(content={"detail": [e.detail]}, status_code=e.status_code)
        except Exception as e:
            logger.exception(e)
            response = ORJSONResponse(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                content={"detail": [{"msg": "Unknown", "code": "Unknown"}]},
            )

        return response
