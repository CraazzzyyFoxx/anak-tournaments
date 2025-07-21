from typing import Annotated
from asyncio import Lock

import httpx
from cachetools import TTLCache
from clerk_backend_api import Clerk
from fastapi import HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwk, jwt, JWTError, ExpiredSignatureError
from loguru import logger
from starlette.requests import Request

from src.core.config import settings
from src.schemas.clerk import ClerkUser


jwks_cache = TTLCache(maxsize=1, ttl=3600)
jwks_cache_lock = Lock()

http_client = httpx.AsyncClient()
clerk_client = Clerk(bearer_auth=settings.clerk_secret_key)
security = HTTPBearer()


async def get_jwks(force_refresh: bool = False) -> dict:
    """
    Asynchronously fetches the JWKS from Clerk, using a TTL cache.
    :param force_refresh: If True, bypasses the cache and fetches fresh data.
    """
    if not force_refresh:
        cached_jwks = jwks_cache.get("jwks")
        if cached_jwks:
            logger.debug("JWKS retrieved from cache.")
            return cached_jwks

    # If data is not in cache or a refresh is forced,
    # use a lock to ensure only one request performs the update.
    async with jwks_cache_lock:
        # Double-check inside the lock in case another request already updated the cache while we were waiting.
        if not force_refresh:
            cached_jwks = jwks_cache.get("jwks")
            if cached_jwks:
                logger.debug("JWKS retrieved from cache (after acquiring lock).")
                return cached_jwks

        logger.info(f"Refreshing JWKS cache from URL: {settings.clerk_jwks_url}")
        try:
            response = await http_client.get(settings.clerk_jwks_url)
            response.raise_for_status()
            jwks = response.json()
            jwks_cache["jwks"] = jwks  # Store the fresh data in the cache
            logger.success("JWKS cache successfully updated.")
            return jwks
        except httpx.RequestError as e:
            logger.error(f"Failed to refresh JWKS cache. Network error: {e}")
            raise HTTPException(status_code=503, detail="Could not contact the authentication provider.")
        except Exception as e:
            logger.error(f"An unexpected error occurred while refreshing JWKS cache: {e}")
            raise HTTPException(status_code=500, detail="Internal error processing authentication keys.")


async def get_public_key(kid: str):
    """
    Finds a public key. If the key is not found, it forces a JWKS refresh and tries again.
    """
    logger.debug(f"Searching for public key with kid: {kid}")

    # First attempt: find the key in the current (possibly cached) set
    jwks = await get_jwks()
    for key in jwks["keys"]:
        if key["kid"] == kid:
            logger.success(f"Found public key for kid: {kid}")
            return jwk.construct(key)

    # If key is not found, it might be due to key rotation.
    # Force a cache refresh and search again.
    logger.warning(f"Key with kid '{kid}' not found. Forcing JWKS cache refresh.")
    jwks = await get_jwks(force_refresh=True)
    for key in jwks["keys"]:
        if key["kid"] == kid:
            logger.success(f"Found public key for kid: {kid} (after refresh).")
            return jwk.construct(key)

    # If the key is still not found after a refresh, the token is genuinely invalid.
    logger.error(f"Public key with kid '{kid}' not found even after refreshing JWKS.")
    raise HTTPException(status_code=401, detail="Invalid token: public key not found.")


async def decode_token(token: str) -> dict:
    """
    Asynchronously decodes and validates a JWT token.
    """
    logger.info("Attempting to decode JWT token.")
    try:
        headers = jwt.get_unverified_headers(token)
        kid = headers.get("kid")
        if not kid:
            logger.warning("Token headers are missing 'kid'.")
            raise HTTPException(status_code=401, detail="Invalid token: 'kid' is missing in the header.")

        logger.debug(f"Found kid in token header: {kid}")
        public_key = await get_public_key(kid)

        payload = jwt.decode(
            token,
            public_key.to_pem().decode("utf-8"),
            algorithms=["RS256"],
            issuer=settings.clerk_issuer,
        )
        logger.success("Token successfully decoded and validated.")
        return payload
    except ExpiredSignatureError:
        logger.warning("Validation failed: Token has expired.")
        raise HTTPException(status_code=401, detail="Token has expired.")
    except JWTError as e:
        logger.warning(f"Token validation error: {e}")
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")
    except HTTPException as e:
        raise e
    except Exception as e:
        logger.error(f"Unexpected error during token decoding: {e}")
        raise HTTPException(status_code=401, detail="Failed to process token.")


async def get_current_user(
    request: Request, token: Annotated[HTTPAuthorizationCredentials, Depends(security)]
) -> ClerkUser:
    """
    FastAPI dependency to authenticate a user by token, now fully asynchronous and cached.
    """
    logger.info("Authenticating user via Bearer token...")
    try:
        credentials = token.credentials
        payload = await decode_token(credentials)

        user_id = payload.get("sub")
        if not user_id:
            logger.warning("Token is valid, but 'sub' (user_id) claim is missing.")
            raise HTTPException(status_code=401, detail="User ID not found in token.")

        user = ClerkUser(
            user_id=user_id,
            permissions=payload.get("permissions"),
            organization=payload.get("organization"),
            role=payload.get("role"),
        )
        logger.success(f"User successfully authenticated: user_id='{user.user_id}'")
        return user
    except HTTPException as e:
        logger.error(f"Authentication error: {e.status_code} - {e.detail}")
        raise e
    except Exception:
        logger.exception("An unexpected error occurred during user authentication.")
        raise HTTPException(status_code=500, detail="Internal server error during authentication.")
