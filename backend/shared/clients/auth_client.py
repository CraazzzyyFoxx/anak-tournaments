"""Centralized authentication client for validating JWT tokens."""

import httpx
from loguru import logger

from .circuit_breaker import CircuitBreakerOpen
from .http_client import ResilientHttpClient


class AuthClient:
    """Client for interacting with the authentication service.

    This client validates JWT tokens by calling the auth service's validation endpoint.
    It uses the ResilientHttpClient for connection pooling, retries, and circuit breaking.

    Example:
        ```python
        auth_client = AuthClient(base_url="http://auth:8001", timeout=5.0)

        await auth_client.start()
        try:
            user_data = await auth_client.validate_token(token)
            if user_data:
                print(f"Token valid for user: {user_data['id']}")
            else:
                print("Invalid token")
        finally:
            await auth_client.close()
        ```
    """

    def __init__(self, base_url: str, timeout: float = 5.0):
        """Initialize the auth client.

        Args:
            base_url: Base URL of the auth service (e.g., "http://auth:8001")
            timeout: Request timeout in seconds
        """
        self._http = ResilientHttpClient(
            base_url=base_url,
            timeout=timeout,
            max_retries=2,  # Auth is latency-sensitive, don't retry too many times
        )

    async def start(self) -> None:
        """Start the HTTP client with connection pooling.

        Should be called during application startup.
        """
        await self._http.start()

    async def close(self) -> None:
        """Close the HTTP client and clean up connections.

        Should be called during application shutdown.
        """
        await self._http.close()

    async def validate_token(self, token: str) -> dict | None:
        """Validate a JWT token with the auth service.

        Args:
            token: JWT token to validate

        Returns:
            User data dict if token is valid, None if invalid

        Raises:
            CircuitBreakerOpen: If auth service circuit breaker is open
            Exception: For other unexpected errors
        """
        try:
            response = await self._http.post(
                "/validate",
                headers={"Authorization": f"Bearer {token}"},
            )

            if response.status_code == 200:
                return response.json()
            elif response.status_code == 401:
                # Invalid token
                return None
            else:
                logger.warning(
                    f"Unexpected status code from auth service: {response.status_code}",
                )
                return None

        except CircuitBreakerOpen:
            logger.warning("Auth service circuit breaker is open — rejecting token validation")
            raise
        except httpx.TimeoutException:
            logger.warning("Auth service request timed out during token validation")
            return None
        except httpx.HTTPError:
            logger.exception("HTTP error validating token")
            return None
        except Exception:
            logger.exception("Unexpected error validating token")
            raise

    async def validate_service_token(self, token: str) -> dict | None:
        """Validate a service JWT token with the auth service.

        Returns the decoded payload if valid, otherwise None.
        """
        try:
            response = await self._http.post(
                "/service/validate",
                headers={"Authorization": f"Bearer {token}"},
            )

            if response.status_code == 200:
                return response.json()
            if response.status_code in (401, 403):
                return None

            logger.warning(
                f"Unexpected status code from auth service (service validate): {response.status_code}",
            )
            return None

        except CircuitBreakerOpen:
            logger.warning("Auth service circuit breaker is open — rejecting service token validation")
            raise
        except httpx.TimeoutException:
            logger.warning("Auth service request timed out during service token validation")
            return None
        except httpx.HTTPError:
            logger.exception("HTTP error validating service token")
            return None
