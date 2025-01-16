import typing
from pathlib import Path

from pydantic import RedisDsn, EmailStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class AppConfig(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", ".env.prod"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Application
    debug: bool = False
    project_name: str = "Anak Tournaments Parser API"
    project_version: str = "0.0.1"
    environment: typing.Literal["development", "production"] = "development"
    project_url: str
    battle_tag_regex: str = r"([\w0-9]{2,12}#[0-9]{4,})"

    cors_origins: list[str] = []

    celery_broker_url: RedisDsn
    celery_result_backend: RedisDsn
    redis_password: str

    # Logging
    log_level: str = "info"
    logs_root_path: str = f"{Path.cwd()}/logs"
    logs_celery_root_path: str = f"{Path.cwd()}/logs/celery"
    sentry_dsn: str | None = None

    super_user_email: EmailStr
    super_user_password: str
    access_token_secret: str

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


app = AppConfig()
