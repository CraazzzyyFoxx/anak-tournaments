"""
HTTP client for auth-service
"""
import httpx
from fastapi import HTTPException, status

from src.core.logging import logger
from src.core.config import settings


class AuthClient:
    """Client for authentication service"""
    
    def __init__(self, base_url: str | None = None):
        self.base_url = base_url or getattr(settings, 'auth_service_url', "http://localhost:8001")
        self._client = None
        
    async def validate_token(self, token: str) -> dict | None:
        """
        Validate JWT token via auth-service
        Returns user payload if valid, None otherwise
        """
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/auth/validate",
                    headers={"Authorization": f"Bearer {token}"},
                    timeout=5.0
                )
                
                if response.status_code == 200:
                    return response.json()
                elif response.status_code == 401:
                    logger.warning("Token validation failed: Unauthorized")
                    return None
                else:
                    logger.warning(f"Token validation failed: {response.status_code}")
                    return None
                    
        except httpx.TimeoutException as exc:
            logger.error("Auth service timeout")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Authentication service unavailable"
            ) from exc
        except httpx.ConnectError as exc:
            logger.error("Cannot connect to auth service")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Authentication service unavailable"
            ) from exc
        except Exception as e:
            logger.error(f"Auth service error: {e}")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Authentication service error"
            ) from e


# Singleton instance
auth_client = AuthClient()
