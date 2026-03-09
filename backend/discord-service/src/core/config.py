from pathlib import Path

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

    # Observability
    sentry_dsn: str | None = None
    sentry_traces_sample_rate: float = 0.1
    sentry_profiles_sample_rate: float = 0.1
    json_logging: bool = True

    # Discord Bot
    discord_token: str

    # Parser Service
    parser_url: str

    # Auth Service (service-to-service token)
    auth_service_url: str = "http://auth:8001"
    service_client_id: str
    service_client_secret: str
    service_token_skew_seconds: int = 30

    # Database (shared with main app)
    postgres_host: str
    postgres_port: int
    postgres_db: str
    postgres_user: str
    postgres_password: str

    # Proxy (optional)
    proxy_ip: str | None = None
    proxy_port: int | None = None
    proxy_username: str | None = None
    proxy_password: str | None = None

    # RabbitMQ (optional)
    rabbitmq_url: str | None = None

    @property
    def broker_url(self) -> str | None:
        return self.rabbitmq_url

    @property
    def db_url_asyncpg(self):
        """Get async database URL"""
        url = (
            f"{self.postgres_user}:{self.postgres_password}@"
            f"{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )
        return f"postgresql+asyncpg://{url}"


settings = Settings()
