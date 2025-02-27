import typing
from pathlib import Path

from pydantic import RedisDsn
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", ".env.prod"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Application
    project_name: str = "Anak Tournaments API"
    project_version: str = "0.0.1"
    environment: typing.Literal["development", "production"] = "development"
    project_url: str
    battle_tag_regex: str = r"([\w0-9]{2,12}#[0-9]{4,})"
    api_v1_str: str = "/api/v1"

    cors_origins: list[str] = []

    # Logging
    log_level: str = "info"
    logs_root_path: str = f"{Path.cwd()}/logs"
    logs_celery_root_path: str = f"{Path.cwd()}/logs/celery"
    sentry_dsn: str | None = None

    # Postgres
    postgres_user: str
    postgres_password: str
    postgres_db: str
    postgres_host: str
    postgres_port: str

    redis_url: RedisDsn

    users_cache_ttl: int = 60 * 60
    tournaments_cache_ttl: int = 24 * 60 * 60
    gamemodes_cache_ttl: int = 24 * 60 * 60
    maps_cache_ttl: int = 24 * 60 * 60
    heroes_cache_ttl: int = 24 * 60 * 60
    statistics_cache_ttl: int = 24 * 60 * 60
    teams_cache_ttl: int = 24 * 60 * 60
    encounters_cache_ttl: int = 24 * 60 * 60
    achievements_cache_ttl: int = 24 * 60 * 60

    clerk_secret_key: str
    clerk_jwks_url: str
    clerk_issuer: str

    @property
    def db_url_asyncpg(self):
        url = (
            f"{self.postgres_user}:{self.postgres_password}@"
            f"{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )
        return f"postgresql+asyncpg://{url}"

    @property
    def db_url(self):
        url = (
            f"{self.postgres_user}:{self.postgres_password}@"
            f"{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )
        return f"postgresql+psycopg://{url}"

    @property
    def api_cache_url(self):
        return f"{self.redis_url}/3"

    @property
    def backend_cache_url(self):
        return f"{self.redis_url}/4"


settings = Settings()
