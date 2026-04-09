import typing
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

__all__ = ("BaseServiceSettings",)


class BaseServiceSettings(BaseSettings):
    """Common settings shared across all microservices.

    Services extend this class and add their own specific fields::

        class Settings(BaseServiceSettings):
            redis_url: RedisDsn
            my_custom_field: str = "default"
    """

    model_config = SettingsConfigDict(
        env_file=(".env", ".env.prod"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Application
    project_name: str = "Anak Service"
    version: str = "0.0.1"
    environment: typing.Literal["development", "production", "staging"] = "development"
    host: str = "localhost"
    port: int = 8000

    # Postgres
    postgres_user: str
    postgres_password: str
    postgres_db: str
    postgres_host: str
    postgres_port: str | int

    # Auth Service
    auth_service_url: str = "http://auth:8001"
    auth_service_timeout: float = 5.0
    auth_service_max_retries: int = 2

    # Database pool
    db_pool_size: int = 10
    db_max_overflow: int = 20
    db_statement_timeout: int = 30000  # milliseconds

    # Circuit Breaker
    circuit_breaker_failure_threshold: int = 5
    circuit_breaker_recovery_timeout: float = 30.0

    # CORS
    cors_origins: list[str] = []

    # Logging
    log_level: str = "info"
    logs_root_path: str = str(Path.cwd() / "logs")
    json_logging: bool = True

    # S3 / MinIO (optional – only needed by services that use storage)
    s3_access_key: str | None = None
    s3_secret_key: str | None = None
    s3_endpoint_url: str | None = None
    s3_bucket_name: str = "aqt"
    s3_public_url: str | None = None  # e.g. "https://minio.craazzzyyfoxx.me/aqt"

    # Observability
    sentry_dsn: str | None = None
    sentry_traces_sample_rate: float = 0.1
    sentry_profiles_sample_rate: float = 0.1
    otlp_endpoint: str | None = None
    tracing_enabled: bool = False

    @property
    def db_url_asyncpg(self) -> str:
        url = (
            f"{self.postgres_user}:{self.postgres_password}@"
            f"{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )
        return f"postgresql+asyncpg://{url}"

    @property
    def db_url(self) -> str:
        url = (
            f"{self.postgres_user}:{self.postgres_password}@"
            f"{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )
        return f"postgresql+psycopg://{url}"
