from typing import Annotated

import httpx
from clerk_backend_api import Clerk
from fastapi import HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwk, jwt
from starlette.requests import Request

from src.core.config import settings
from src.core.logging import logger
from src.schemas.clerk import ClerkUser

clerk_client = Clerk(bearer_auth=settings.clerk_secret_key)
security = HTTPBearer()


def get_jwks():
    response = httpx.get(settings.clerk_jwks_url)
    return response.json()


def get_public_key(kid: str):
    jwks = get_jwks()
    for key in jwks["keys"]:
        if key["kid"] == kid:
            return jwk.construct(key)
    raise HTTPException(status_code=401, detail="Invalid token")


def decode_token(token: str):
    headers = jwt.get_unverified_headers(token)
    kid = headers["kid"]
    public_key = get_public_key(kid)
    return jwt.decode(
        token,
        public_key.to_pem().decode("utf-8"),
        algorithms=["RS256"],
        issuer=settings.clerk_issuer,
    )


async def get_current_user(
    request: Request, token: Annotated[HTTPAuthorizationCredentials, Depends(security)]
):
    token = token.credentials
    payload = decode_token(token)
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="User ID not found in token")

    return ClerkUser(
        user_id=user_id,
        permissions=payload.get("permissions"),
        organization=payload.get("organization"),
        role=payload.get("role"),
    )
