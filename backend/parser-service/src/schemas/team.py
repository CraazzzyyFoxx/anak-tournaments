import typing

from src.schemas import BaseRead
from src.schemas.tournament import TournamentRead
from src.schemas.user import UserRead

__all__ = (
    "TeamRead",
    "PlayerRead",
)

class PlayerRead(BaseRead):
    name: str
    sub_role: str | None
    rank: int
    division: int
    role: str
    tournament_id: int
    user_id: int
    team_id: int
    is_newcomer: bool
    is_newcomer_role: bool
    is_substitution: bool
    related_player_id: int | None

    tournament: TournamentRead | None
    team: typing.Optional["TeamRead"]
    user: UserRead | None


class TeamRead(BaseRead):
    name: str
    image_url: str | None = None
    avg_sr: float
    total_sr: int
    tournament_id: int
    captain_id: int
    tournament: TournamentRead | None
    players: list[PlayerRead]
    captain: UserRead | None
    placement: int | None
