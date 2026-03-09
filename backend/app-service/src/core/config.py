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
    version: str = "0.0.1"
    environment: typing.Literal["development", "production"] = "development"
    project_url: str
    battle_tag_regex: str = r"([\w0-9]{2,12}#[0-9]{4,})"
    api_v1_str: str = "/api/v1"
    
    host: str = "localhost"
    port: int = 8000

    # Auth Service
    auth_service_url: str = "http://auth:8001"
    auth_service_timeout: float = 5.0
    auth_service_max_retries: int = 2

    # Circuit Breaker
    circuit_breaker_failure_threshold: int = 5
    circuit_breaker_recovery_timeout: float = 30.0

    cors_origins: list[str] = []

    # Logging
    log_level: str = "info"
    logs_root_path: str = f"{Path.cwd()}/logs"

    # Observability
    sentry_dsn: str | None = None
    sentry_traces_sample_rate: float = 0.1  # 10% sampling (was 100%)
    sentry_profiles_sample_rate: float = 0.1
    otlp_endpoint: str | None = None  # e.g., "http://jaeger:4317"
    tracing_enabled: bool = False
    json_logging: bool = True  # True for production JSON logs

    # Postgres
    postgres_user: str
    postgres_password: str
    postgres_db: str
    postgres_host: str
    postgres_port: str

    redis_url: RedisDsn

    users_cache_ttl: int = 60
    tournaments_cache_ttl: int = 60 * 5
    gamemodes_cache_ttl: int = 60 * 5
    maps_cache_ttl: int = 60 * 5
    heroes_cache_ttl: int = 60 * 5
    statistics_cache_ttl: int = 60 * 5
    teams_cache_ttl: int = 60 * 5
    encounters_cache_ttl: int = 60 * 5
    achievements_cache_ttl: int = 60 * 5

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
