"""HTTP access to the parser service and the machine-to-machine service token
that authenticates internal calls to it.
"""

from __future__ import annotations

import asyncio
import time

import httpx
from loguru import logger

from src.core.config import Settings


class ServiceTokenClient:
    """Caches the client-credentials service token used for internal calls.

    Double-checked locking: the fast path (a still-valid cached token) never
    touches the lock, and concurrent callers racing a refresh share one HTTP
    round trip instead of each minting their own token.
    """

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._token: str | None = None
        self._expires_at: float = 0.0
        self._lock = asyncio.Lock()

    def _is_valid(self, now: float) -> bool:
        return bool(self._token) and now < (self._expires_at - self._settings.service_token_skew_seconds)

    async def get_token(self) -> str:
        now = time.time()
        if self._is_valid(now):
            assert self._token is not None
            return self._token

        async with self._lock:
            now = time.time()
            if self._is_valid(now):
                assert self._token is not None
                return self._token

            async with httpx.AsyncClient(
                base_url=self._settings.auth_service_url,
                timeout=httpx.Timeout(5.0),
            ) as client:
                res = await client.post(
                    "/service/token",
                    json={
                        "client_id": self._settings.service_client_id,
                        "client_secret": self._settings.service_client_secret,
                    },
                )

            if res.status_code != 200:
                logger.error(f"Failed to obtain service token (status={res.status_code})")
                raise RuntimeError("Failed to obtain service token")

            data = res.json()
            token = data.get("access_token")
            expires_in = int(data.get("expires_in", 300))
            if not token:
                raise RuntimeError("Invalid service token response")

            self._token = str(token)
            self._expires_at = time.time() + expires_in
            return self._token


class ParserClientFactory:
    """Builds ``httpx.AsyncClient``s for talking to the parser service and Discord.

    ``destination="internal"`` targets the parser service directly (bypassing the
    egress proxy) with a service-token bearer header. Anything else (e.g.
    ``"discord"``, for downloading an attachment straight from its CDN URL) goes
    through the configured egress proxy, unauthenticated.
    """

    def __init__(self, settings: Settings, token_client: ServiceTokenClient | None = None) -> None:
        self._settings = settings
        self._tokens = token_client or ServiceTokenClient(settings)

    async def create(self, destination: str = "internal") -> httpx.AsyncClient:
        headers: dict[str, str] = {}
        if destination == "internal":
            headers["Authorization"] = f"Bearer {await self._tokens.get_token()}"

        return httpx.AsyncClient(
            base_url=self._settings.parser_url,
            headers=headers,
            proxy=self._settings.proxy_url if destination != "internal" else None,
            timeout=httpx.Timeout(30, read=60),
        )
