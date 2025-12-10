"""
Configuration module for auth service
"""
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings"""
    
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Application
    PROJECT_NAME: str = "Authentication Service"
    ENVIRONMENT: str = "development"
    DEBUG: bool = True
    HOST: str = "0.0.0.0"
    PORT: int = 8001
    API_V1_STR: str = "/api/v1"

    POSTGRES_HOST: str
    POSTGRES_PORT: int
    POSTGRES_DB: str
    POSTGRES_USER: str
    POSTGRES_PASSWORD: str

    # JWT Authentication
    JWT_SECRET_KEY: str = Field(default="your-secret-key-change-in-production-min-32-chars")
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    # CORS
    ALLOWED_ORIGINS: list[str] = ["http://localhost:3000", "http://localhost:8000"]

    # Discord OAuth
    DISCORD_CLIENT_ID: str = Field(default="")
    DISCORD_CLIENT_SECRET: str = Field(default="")
    DISCORD_REDIRECT_URI: str = "http://localhost:8001/auth/discord/callback"
    DISCORD_OAUTH_URL: str = "https://discord.com/api/oauth2/authorize"
    DISCORD_TOKEN_URL: str = "https://discord.com/api/oauth2/token"
    DISCORD_API_URL: str = "https://discord.com/api/v10"

    @property
    def db_url_asyncpg(self):
        """Get async database URL"""
        url = (
            f"{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}@"
            f"{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )
        return f"postgresql+asyncpg://{url}"

    @property
    def db_url(self):
        """Get sync database URL"""
        url = (
            f"{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}@"
            f"{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )
        return f"postgresql+psycopg://{url}"


settings = Settings()
