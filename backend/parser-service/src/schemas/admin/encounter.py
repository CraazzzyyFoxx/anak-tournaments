from pydantic import BaseModel, Field

__all__ = (
    "EncounterCreate",
    "EncounterUpdate",
    "MatchUpdate",
)


class EncounterCreate(BaseModel):
    """Schema for creating an encounter"""

    name: str
    tournament_id: int
    tournament_group_id: int | None = None
    stage_id: int | None = None
    stage_item_id: int | None = None
    home_team_id: int | None = None
    away_team_id: int | None = None
    round: int
    home_score: int = 0
    away_score: int = 0
    status: str = "open"  # open, pending, completed


class EncounterUpdate(BaseModel):
    """Schema for updating an encounter"""

    name: str | None = None
    tournament_group_id: int | None = None
    stage_id: int | None = None
    stage_item_id: int | None = None
    home_team_id: int | None = None
    away_team_id: int | None = None
    home_score: int | None = None
    away_score: int | None = None
    status: str | None = None
    round: int | None = None
    closeness: float | None = Field(default=None, ge=0.0, le=1.0)


class MatchUpdate(BaseModel):
    """Partial update for a single match (map) within an encounter."""

    home_team_id: int | None = None
    away_team_id: int | None = None
    home_score: int | None = None
    away_score: int | None = None
    map_id: int | None = None
    code: str | None = None
    time: float | None = None
    log_name: str | None = None
