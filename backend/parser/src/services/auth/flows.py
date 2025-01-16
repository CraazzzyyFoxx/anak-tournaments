from typing import Annotated

from fastapi import Depends
from fastapi.security import OAuth2PasswordBearer


from . import service
from ...core import errors

oauth2_scheme = OAuth2PasswordBearer("auth/login", auto_error=False)


async def get_current_user(
    token: str,
):
    user = False
    if token is not None:
        user = await service.verify_access_token(token)
    return user, token


def _current_user():
    async def current_user_dependency(token: Annotated[str, Depends(oauth2_scheme)]):
        user, _ = await get_current_user(token)
        if not user:
            raise errors.ApiHTTPException(
                status_code=401,
                detail=[errors.ApiException(msg="Missing Permissions", code="unauthorized")],
            )
        return user

    return current_user_dependency


current_user = _current_user()
