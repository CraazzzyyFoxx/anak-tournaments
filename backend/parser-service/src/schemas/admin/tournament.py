from datetime import date
from pydantic import BaseModel

__all__ = (
    "TournamentCreate",
    "TournamentUpdate",
    "TournamentGroupCreate",
    "TournamentGroupUpdate",
)


class TournamentCreate(BaseModel):
    """Schema for creating a tournament"""

    number: int | None = None
    name: str
    description: str | None = None
    is_league: bool = False
    start_date: date
    end_date: date


class TournamentUpdate(BaseModel):
    """Schema for updating a tournament"""

    name: str | None = None
    description: str | None = None
    is_finished: bool | None = None
    start_date: date | None = None
    end_date: date | None = None


class TournamentGroupCreate(BaseModel):
    """Schema for creating a tournament group"""

    name: str
    description: str | None = None
    is_playoffs: bool = False
    is_groups: bool = True


class TournamentGroupUpdate(BaseModel):
    """Schema for updating a tournament group"""

    name: str | None = None
    description: str | None = None
    is_playoffs: bool | None = None
    is_groups: bool | None = None
