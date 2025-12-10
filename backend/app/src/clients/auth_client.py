"""
HTTP client for auth-service
"""
import httpx
from fastapi import HTTPException, status

from app.src.core.logging import logger


class AuthClient:
    """Client for authentication service"""
    
    def __init__(self, base_url: str = "http://localhost:8080"):
        self.base_url = base_url
        
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
                else:
                    logger.warning(f"Token validation failed: {response.status_code}")
                    return None
                    
        except httpx.TimeoutException:
            logger.error("Auth service timeout")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Authentication service unavailable"
            )
        except Exception as e:
            logger.error(f"Auth service error: {e}")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Authentication service error"
            )


# Singleton instance
auth_client = AuthClient()
