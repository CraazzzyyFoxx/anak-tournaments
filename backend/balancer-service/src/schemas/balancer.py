from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class ConfigOverrides(BaseModel):
    """Optional configuration overrides for the balancing algorithm"""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    # Role mask configuration
    MASK: dict[str, int] | None = Field(
        None,
        alias="DEFAULT_MASK",
        description="Role mask defining required players per role (e.g., {'Tank': 1, 'Damage': 2, 'Support': 2})",
    )

    # Genetic Algorithm parameters
    POPULATION_SIZE: int | None = Field(None, ge=10, le=1000, description="Population size for genetic algorithm")
    GENERATIONS: int | None = Field(None, ge=10, le=5000, description="Number of generations")
    ELITISM_RATE: float | None = Field(None, ge=0, le=1, description="Percentage of elite solutions to preserve")
    MUTATION_RATE: float | None = Field(None, ge=0, le=1, description="Probability of mutation")
    MUTATION_STRENGTH: int | None = Field(None, ge=1, le=10, description="Number of mutation operations per mutation")

    # Cost function weights
    MMR_DIFF_WEIGHT: float | None = Field(None, ge=0, description="Weight for MMR difference between teams")
    DISCOMFORT_WEIGHT: float | None = Field(None, ge=0, description="Weight for player role discomfort")
    INTRA_TEAM_VAR_WEIGHT: float | None = Field(None, ge=0, description="Weight for variance within teams")
    MAX_DISCOMFORT_WEIGHT: float | None = Field(None, ge=0, description="Weight for maximum discomfort penalty")

    # Strategy configuration
    USE_CAPTAINS: bool | None = Field(None, description="Whether to use captain assignment")
    ROLE_MAPPING: dict[str, str] | None = Field(
        None,
        alias="DEFAULT_ROLE_MAPPING",
        description="Mapping from input role names to algorithm role names",
    )


class BalanceRequest(BaseModel):
    """Request schema for team balancing"""

    data: dict = Field(..., description="Player data in the tournament format")
    config: ConfigOverrides | None = Field(None, description="Optional configuration overrides")


class PlayerData(BaseModel):
    """Individual player data in a team"""

    uuid: str
    name: str
    rating: int
    discomfort: int
    isCaptain: bool
    preferences: list[str]
    allRatings: dict[str, int]


class TeamData(BaseModel):
    """Team data with roster and statistics"""

    id: int
    name: str
    avgMMR: float
    variance: float
    totalDiscomfort: int
    maxDiscomfort: int
    roster: dict[str, list[PlayerData]]


class Statistics(BaseModel):
    """Overall statistics for the balanced teams"""

    averageMMR: float
    mmrStdDev: float
    totalTeams: int
    playersPerTeam: int


class BalanceResponse(BaseModel):
    """Response schema for team balancing"""

    teams: list[TeamData]
    statistics: Statistics
    appliedConfig: dict[str, Any] | None = None


class BalancerConfigResponse(BaseModel):
    """Runtime balancing configuration exposed for UI forms."""

    defaults: dict[str, Any]
    limits: dict[str, dict[str, int | float]]
    presets: dict[str, dict[str, Any]]


class JobProgress(BaseModel):
    current: int | None = None
    total: int | None = None
    percent: float | None = None


class JobEvent(BaseModel):
    event_id: int
    timestamp: float
    level: str
    status: Literal["queued", "running", "succeeded", "failed"]
    stage: str
    message: str
    progress: JobProgress | None = None


class CreateJobResponse(BaseModel):
    job_id: str
    status: Literal["queued", "running", "succeeded", "failed"]
    status_url: str
    result_url: str
    stream_url: str


class JobStatusResponse(BaseModel):
    job_id: str
    status: Literal["queued", "running", "succeeded", "failed"]
    stage: str | None = None
    created_at: float
    started_at: float | None = None
    finished_at: float | None = None
    progress: JobProgress | None = None
    error: str | None = None
    events_count: int = 0
