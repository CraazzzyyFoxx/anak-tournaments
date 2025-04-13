from pathlib import Path

from pydantic import RedisDsn
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", ".env.prod"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Logging
    log_level: str = "info"
    logs_root_path: str = f"{Path.cwd()}/logs"
    logs_celery_root_path: str = f"{Path.cwd()}/logs/discord"

    redis_url: RedisDsn
    discord_token: str
    discord_channel_id: int
    discord_guild_id: int
    api_url: str

    access_token_service: str


settings = Settings()
