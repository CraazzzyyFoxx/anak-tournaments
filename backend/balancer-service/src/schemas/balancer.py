from pydantic import BaseModel, Field


class ConfigOverrides(BaseModel):
    """Optional configuration overrides for the balancing algorithm"""
    # Role mask configuration
    MASK: dict[str, int] | None = Field(None, description="Role mask defining required players per role (e.g., {'DPS': 3, 'Support': 2})")
    
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
    ROLE_MAPPING: dict[str, str] | None = Field(None, description="Mapping from input role names to algorithm role names")


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
