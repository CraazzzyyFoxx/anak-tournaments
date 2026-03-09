"""
Configuration module for balancer service using Pydantic models.

This module provides comprehensive settings for the FastAPI balancer service,
including application settings, algorithm parameters, and runtime configuration.
"""

from __future__ import annotations

import typing
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class AlgorithmConfig(BaseSettings):
    """
    Configuration for the genetic algorithm balancing parameters.

    These settings can be overridden per-request but provide sensible defaults.
    """

    model_config = SettingsConfigDict(
        env_prefix="BALANCER_",
        extra="ignore",
    )

    # Role configuration
    DEFAULT_MASK: dict[str, int] = Field(
        default={"Tank": 1, "Damage": 2, "Support": 2},
        description="Default role mask defining required players per role",
    )

    # Genetic Algorithm parameters
    POPULATION_SIZE: int = Field(default=200, ge=10, le=1000, description="Population size for genetic algorithm")
    GENERATIONS: int = Field(default=750, ge=10, le=5000, description="Number of generations to evolve")
    ELITISM_RATE: float = Field(
        default=0.2, ge=0.0, le=1.0, description="Percentage of elite solutions to preserve each generation"
    )
    MUTATION_RATE: float = Field(default=0.4, ge=0.0, le=1.0, description="Probability of mutation occurring")
    MUTATION_STRENGTH: int = Field(
        default=3, ge=1, le=10, description="Number of mutation operations per mutation event"
    )

    # Cost function weights
    MMR_DIFF_WEIGHT: float = Field(
        default=3.0, ge=0.0, description="Weight for MMR difference between teams (higher = more balanced teams)"
    )
    DISCOMFORT_WEIGHT: float = Field(
        default=0.25, ge=0.0, description="Weight for player role discomfort (higher = better role matching)"
    )
    INTRA_TEAM_VAR_WEIGHT: float = Field(
        default=0.8, ge=0.0, description="Weight for variance within teams (higher = more consistent team members)"
    )
    MAX_DISCOMFORT_WEIGHT: float = Field(
        default=1.0,
        ge=0.0,
        description="Weight for maximum discomfort penalty (higher = avoid worst-case role assignments)",
    )

    # Strategy configuration
    USE_CAPTAINS: bool = Field(default=True, description="Whether to enable captain assignment for teams")
    DEFAULT_ROLE_MAPPING: dict[str, str] = Field(
        default={"tank": "Tank", "dps": "Damage", "support": "Support"},
        description="Default mapping from input role names to algorithm role names",
    )


class Settings(BaseSettings):
    """
    Main application settings for the Balancer Service.

    Loads configuration from environment variables and .env files.
    """

    model_config = SettingsConfigDict(
        env_file=(".env", ".env.prod"),
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    # Application metadata
    PROJECT_NAME: str = Field(default="Anak Tournaments", description="Project name for display purposes")
    VERSION: str = Field(default="1.0.0", description="API version")
    DESCRIPTION: str = Field(
        default="Tournament team balancing service using genetic algorithms", description="API description"
    )

    # Environment
    ENVIRONMENT: typing.Literal["development", "production", "staging"] = Field(
        default="development", description="Current runtime environment"
    )
    DEBUG: bool = Field(default=False, description="Enable debug mode")

    # Server configuration
    HOST: str = Field(default="0.0.0.0", description="Host to bind the server to")
    PORT: int = Field(default=8005, ge=1, le=65535, description="Port for balancer service")

    # Auth Service
    AUTH_SERVICE_URL: str = Field(default="http://auth:8001", description="Auth service base URL")
    AUTH_SERVICE_TIMEOUT: float = Field(default=5.0, ge=0.1, description="Auth service timeout in seconds")
    AUTH_SERVICE_MAX_RETRIES: int = Field(default=2, ge=0, description="Max retries for auth service calls")

    # Circuit Breaker
    CIRCUIT_BREAKER_FAILURE_THRESHOLD: int = Field(
        default=5, ge=1, description="Number of failures before opening circuit"
    )
    CIRCUIT_BREAKER_RECOVERY_TIMEOUT: float = Field(
        default=30.0, ge=1.0, description="Seconds to wait before attempting recovery"
    )

    # CORS configuration
    CORS_ORIGINS: list[str] = Field(
        default_factory=lambda: ["http://localhost:3000", "http://localhost:8000"], description="Allowed CORS origins"
    )
    CORS_ALLOW_CREDENTIALS: bool = Field(default=True, description="Allow credentials in CORS requests")
    CORS_ALLOW_METHODS: list[str] = Field(default_factory=lambda: ["*"], description="Allowed HTTP methods for CORS")
    CORS_ALLOW_HEADERS: list[str] = Field(default_factory=lambda: ["*"], description="Allowed HTTP headers for CORS")

    # Infrastructure dependencies
    REDIS_URL: str = Field(default="redis://redis:6379", description="Redis URL used for balancer job storage")
    RABBITMQ_URL: str = Field(
        default="amqp://guest:guest@rabbitmq:5672", description="RabbitMQ URL used for balancer job queue"
    )
    BALANCER_JOB_TTL_SECONDS: int = Field(
        default=86400, ge=60, le=604800, description="How long balancer jobs are retained in Redis"
    )

    # Logging configuration
    LOG_LEVEL: str = Field(default="INFO", description="Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL)")
    LOGS_ROOT_PATH: str = Field(default=str(Path.cwd() / "logs"), description="Root path for log files")
    LOG_FORMAT: str = Field(
        default="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>",
        description="Log format string for loguru",
    )

    # Observability
    SENTRY_DSN: str | None = Field(default=None, description="Sentry DSN for error tracking")
    SENTRY_TRACES_SAMPLE_RATE: float = Field(default=0.1, ge=0.0, le=1.0, description="Sentry traces sample rate")
    SENTRY_PROFILES_SAMPLE_RATE: float = Field(default=0.1, ge=0.0, le=1.0, description="Sentry profiles sample rate")
    OTLP_ENDPOINT: str | None = Field(
        default=None, description="OpenTelemetry OTLP endpoint (e.g., http://jaeger:4317)"
    )
    TRACING_ENABLED: bool = Field(default=False, description="Enable OpenTelemetry tracing")
    JSON_LOGGING: bool = Field(default=True, description="Use JSON logging format (True for production)")

    @field_validator("LOG_LEVEL")
    @classmethod
    def validate_log_level(cls, v: str) -> str:
        """Validate and normalize log level"""
        allowed_levels = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}
        v_upper = v.upper()
        if v_upper not in allowed_levels:
            raise ValueError(f"LOG_LEVEL must be one of {allowed_levels}")
        return v_upper

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def parse_cors_origins(cls, v) -> list[str]:
        """Parse CORS origins from string or list"""
        if isinstance(v, str):
            return [origin.strip() for origin in v.split(",")]
        return v

    @property
    def cors_origins(self) -> list[str]:
        """Alias for backward compatibility"""
        return self.CORS_ORIGINS

    @property
    def log_level(self) -> str:
        """Alias for backward compatibility (lowercase)"""
        # Pydantic fields resolve to actual values at runtime, not FieldInfo
        return self.LOG_LEVEL.lower()  # type: ignore

    @property
    def logs_root_path(self) -> str:
        """Alias for backward compatibility"""
        return self.LOGS_ROOT_PATH

    @property
    def algorithm(self) -> AlgorithmConfig:
        """Get algorithm configuration instance"""
        return AlgorithmConfig()

    def get_algorithm_defaults(self) -> dict:
        """Get algorithm default configuration as dict"""
        return self.algorithm.model_dump()


# Global configuration instance
config = Settings()
