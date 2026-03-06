import typing
from pathlib import Path

from pydantic import RedisDsn
from pydantic_settings import BaseSettings, SettingsConfigDict


class AppConfig(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", ".env.prod"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Application
    debug: bool = False
    project_name: str = "Anak Tournaments"
    version: str = "0.0.1"
    environment: typing.Literal["development", "production"] = "development"
    project_url: str
    battle_tag_regex: str = r"([\w0-9]{2,12}#[0-9]{4,})"

    port: int = 8002
    host: str = "localhost"

    # Auth Service
    auth_service_url: str = "http://auth:8001"  # CRITICAL FIX: was using wrong port 8080
    auth_service_timeout: float = 5.0
    auth_service_max_retries: int = 2

    # Circuit Breaker
    circuit_breaker_failure_threshold: int = 5
    circuit_breaker_recovery_timeout: float = 30.0

    cors_origins: list[str] = []

    redis_url: RedisDsn

    # Logging
    log_level: str = "info"
    logs_root_path: str = f"{Path.cwd()}/logs"

    # Observability
    sentry_dsn: str | None = None
    sentry_traces_sample_rate: float = 0.1  # 10% sampling
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

    challonge_username: str
    challonge_api_key: str

    s3_access_key: str
    s3_secret_key: str
    s3_endpoint_url: str
    s3_bucket_name: str

    proxy_ip: str | None = None
    proxy_port: int | None = None
    proxy_username: str | None = None
    proxy_password: str | None = None

    rabbitmq_url: str | None = None

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
    def broker_url(self):
        return self.rabbitmq_url


settings = AppConfig()
