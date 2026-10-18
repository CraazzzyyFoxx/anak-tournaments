from shared.schemas.role import RoleRef
from src.schemas import BaseRead
from src.schemas.tournament import TournamentRead
from src.schemas.user import UserRead

__all__ = (
    "TeamRead",
    "PlayerRead",
)


class PlayerRead(BaseRead):
    name: str
    rank: int
    division: int
    role: RoleRef | None = None
    tournament_id: int
    user_id: int
    team_id: int
    is_newcomer: bool
    is_newcomer_role: bool
    is_substitution: bool
    related_player_id: int | None

    tournament: TournamentRead | None
    team: TeamRead | None
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
