"""The deadlock-api client: every Deadlock read (catalog, ranks, match metadata) goes through it."""

from __future__ import annotations

from functools import cache

from pydantic_settings import BaseSettings, SettingsConfigDict

from shared.clients.http_client import ResilientHttpClient

__all__ = ("DEADLOCK_API", "api_key", "deadlock_client")

DEADLOCK_API = "https://api.deadlock-api.com"


class DeadlockSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", ".env.prod"), env_file_encoding="utf-8", extra="ignore")

    #: Optional: raises the per-key rate limits (``X-API-KEY``); everything works without it.
    deadlock_api_key: str | None = None


@cache
def api_key() -> str | None:
    """``DEADLOCK_API_KEY`` (env or ``.env``), the ``X-API-KEY`` every request carries when set."""
    return DeadlockSettings().deadlock_api_key


def deadlock_client(*, timeout: float = 15.0, max_retries: int = 3) -> ResilientHttpClient:
    key = api_key()
    return ResilientHttpClient(
        DEADLOCK_API, timeout=timeout, max_retries=max_retries, headers={"X-API-KEY": key} if key else None
    )
