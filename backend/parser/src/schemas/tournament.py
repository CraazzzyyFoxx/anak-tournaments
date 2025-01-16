from datetime import datetime

from pydantic import BaseModel

from src.core import enums
from src.schemas import UserRead
from src.schemas.base import BaseRead


__all__ = ("TournamentRead", "TournamentGroupRead")


class TournamentGroupRead(BaseRead):
    name: str
    description: str | None
    is_groups: bool
    challonge_id: int | None
    challonge_slug: str | None


class TournamentRead(BaseRead):
    number: int | None
    name: str
    description: str | None
    challonge_id: int | None
    challonge_slug: str | None
    is_league: bool
    is_finished: bool
    start_date: datetime
    end_date: datetime

    groups: list[TournamentGroupRead]
