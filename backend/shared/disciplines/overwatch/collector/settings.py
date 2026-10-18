"""Settings only the OverFast rank collector reads (env names are unchanged from when the parser owned them).

Operational params (interval, scope, rate limit, mapping) live in the ``Settings`` table, not here.
"""

from __future__ import annotations

from functools import cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class CollectorSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", ".env.prod"), env_file_encoding="utf-8", extra="ignore")

    # OverFast API (self-hosted instance).
    overfast_base_url: str = "https://overfast.craazzzyyfoxx.me"
    overfast_timeout: float = 15.0
    overfast_max_retries: int = 3
    # FastStream prefetch for the rank-fetch worker (keep low to protect OverFast).
    rank_fetch_worker_prefetch: int = 3


@cache
def settings() -> CollectorSettings:
    return CollectorSettings()
