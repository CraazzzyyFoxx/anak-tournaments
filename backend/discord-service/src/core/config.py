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

    # Discord Bot
    discord_token: str

    # Parser Service
    parser_url: str
    access_token_service: str

    # Database (shared with main app)
    postgres_host: str = "localhost"
    postgres_port: int = 5432
    postgres_db: str = "anak_tournaments"
    postgres_user: str = "postgres"
    postgres_password: str = "postgres"

    # Proxy (optional)
    proxy_ip: str | None = None
    proxy_port: int | None = None
    proxy_username: str | None = None
    proxy_password: str | None = None

    @property
    def db_url_asyncpg(self):
        """Get async database URL"""
        url = (
            f"{self.postgres_user}:{self.postgres_password}@"
            f"{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )
        return f"postgresql+asyncpg://{url}"


settings = Settings()
