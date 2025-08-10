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
    parser_url: str
    tournament_id: int

    proxy_ip: str | None = None
    proxy_port: int | None = None
    proxy_username: str | None = None
    proxy_password: str | None = None

    rabbitmq_url: str | None = None

    access_token_service: str

    @property
    def broker_url(self):
        return self.rabbitmq_url


settings = Settings()
