"""Settings only the Workshop decoder reads (env name unchanged from when the parser owned it).

Same sources as every service setting: the process environment, then ``.env``/``.env.prod``.
"""

from __future__ import annotations

from functools import cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class IngestSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", ".env.prod"), env_file_encoding="utf-8", extra="ignore")

    #: Cap on log rows before a DataFrame is built: an adversarial log would otherwise be parsed in full.
    max_match_log_lines: int = 500_000


@cache
def settings() -> IngestSettings:
    return IngestSettings()
