from fastapi import APIRouter, Depends
from fastapi.responses import ORJSONResponse
from fastapi.security import OAuth2PasswordRequestForm
from starlette import status

from src.core import errors

from . import service

router = APIRouter(prefix="/auth", tags=["Auth"])


@router.post("/login")
async def login(
    credentials: OAuth2PasswordRequestForm = Depends(),
):
    user = await service.authenticate(credentials)
    if not user:
        raise errors.ApiHTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=[errors.ApiExc(msg="LOGIN_BAD_CREDENTIALS", code="LOGIN_BAD_CREDENTIALS")],
        )
    token = await service.create_access_token()
    return ORJSONResponse({"access_token": token, "token_type": "bearer"})
