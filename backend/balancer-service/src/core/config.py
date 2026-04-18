"""Configuration module for balancer service."""

from __future__ import annotations

import typing

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from shared.core.config import BaseServiceSettings


class AlgorithmConfig(BaseSettings):
    """Configuration for the genetic algorithm balancing parameters."""

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
    POPULATION_SIZE: int = Field(default=200, ge=10, le=1000)
    GENERATIONS: int = Field(default=750, ge=10, le=5000)
    ELITISM_RATE: float = Field(default=0.2, ge=0.0, le=1.0)
    MUTATION_RATE: float = Field(default=0.4, ge=0.0, le=1.0)
    MUTATION_STRENGTH: int = Field(default=3, ge=1, le=10)
    STAGNATION_THRESHOLD: int = Field(
        default=30,
        ge=1,
        le=500,
        description=(
            "Number of generations without best-cost improvement before reseeding "
            "the bottom 70% of the population (elite preserved)."
        ),
    )

    # Cost function weights
    MMR_DIFF_WEIGHT: float = Field(default=3.0, ge=0.0)
    TEAM_TOTAL_STD_WEIGHT: float = Field(default=1.0, ge=0.0)
    MAX_TEAM_GAP_WEIGHT: float = Field(default=1.0, ge=0.0)
    DISCOMFORT_WEIGHT: float = Field(default=1.5, ge=0.0)
    INTRA_TEAM_VAR_WEIGHT: float = Field(default=0.8, ge=0.0)
    MAX_DISCOMFORT_WEIGHT: float = Field(default=1.5, ge=0.0)
    ROLE_BALANCE_WEIGHT: float = Field(default=1.0, ge=0.0)
    ROLE_SPREAD_WEIGHT: float = Field(default=1.0, ge=0.0)
    INTRA_TEAM_STD_WEIGHT: float = Field(default=0.0, ge=0.0)
    SUBROLE_COLLISION_WEIGHT: float = Field(
        default=5.0,
        ge=0.0,
        description=(
            "Penalty weight per subclass-collision pair in a team "
            "(e.g., two players with the same subclass on the same role)."
        ),
    )

    # Strategy configuration
    USE_CAPTAINS: bool = Field(default=True)
    DEFAULT_ROLE_MAPPING: dict[str, str] = Field(
        default={"tank": "Tank", "dps": "Damage", "support": "Support"},
    )

    # Algorithm selection
    ALGORITHM: typing.Literal["genetic", "genetic_moo", "cpsat", "nsga"] = Field(default="genetic")
    MAX_CPSAT_SOLUTIONS: int = Field(default=3, ge=1, le=5)
    MAX_GENETIC_SOLUTIONS: int = Field(
        default=10,
        ge=1,
        le=50,
        description=(
            "Maximum number of Pareto solutions returned by the genetic_moo "
            "algorithm (multi-objective legacy GA)."
        ),
    )

    # NSGA-II (mixtura-balancer) settings
    MAX_NSGA_SOLUTIONS: int = Field(default=10, ge=1, le=50)
    MIXTURA_QUEUE: str = Field(default="mix_balance_service.balance")


class Settings(BaseServiceSettings):
    # Balancer-specific fields
    project_name: str = "Anak Tournaments"
    description: str = "Tournament team balancing service using genetic algorithms"
    debug: bool = False
    port: int = 8005

    # Infrastructure
    redis_url: str = "redis://redis:6379"
    rabbitmq_url: str = "amqp://guest:guest@rabbitmq:5672"
    balancer_job_ttl_seconds: int = Field(default=86400, ge=60, le=604800)

    # CORS extras
    cors_allow_credentials: bool = True
    cors_allow_methods: list[str] = Field(default_factory=lambda: ["*"])
    cors_allow_headers: list[str] = Field(default_factory=lambda: ["*"])

    # Logging extras
    log_format: str = (
        "<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> "
        "| <cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>"
    )

    # Access token
    access_token_service: str = ""

    @field_validator("log_level", mode="before")
    @classmethod
    def validate_log_level(cls, v: str) -> str:
        allowed_levels = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}
        v_upper = v.upper()
        if v_upper not in allowed_levels:
            raise ValueError(f"log_level must be one of {allowed_levels}")
        return v_upper

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, v) -> list[str]:
        if isinstance(v, str):
            return [origin.strip() for origin in v.split(",")]
        return v

    @property
    def algorithm(self) -> AlgorithmConfig:
        return AlgorithmConfig()

    def get_algorithm_defaults(self) -> dict:
        return self.algorithm.model_dump()


# Global configuration instance
config = Settings()
