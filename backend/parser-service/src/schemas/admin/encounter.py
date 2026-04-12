from pydantic import BaseModel

__all__ = (
    "EncounterCreate",
    "EncounterUpdate",
)


class EncounterCreate(BaseModel):
    """Schema for creating an encounter"""

    name: str
    tournament_id: int
    tournament_group_id: int | None = None
    stage_id: int | None = None
    stage_item_id: int | None = None
    home_team_id: int
    away_team_id: int
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
