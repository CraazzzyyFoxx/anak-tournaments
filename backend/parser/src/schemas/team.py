import typing

from pydantic import UUID4, BaseModel, Field

from src.schemas import BaseRead
from src.schemas.tournament import TournamentRead
from src.schemas.user import UserRead

__all__ = (
    "BalancerTeamMember",
    "BalancerTeam",
    "TeamRead",
    "PlayerRead",
    "DashaTeamMember",
    "DashaTeam",
)


class BalancerTeamMember(BaseModel):
    uuid: UUID4
    name: str
    primary: bool
    secondary: bool
    role: typing.Literal["tank", "dps", "support"] | None
    rank: int


class DashaTeamMember(BaseModel):
    id: int
    tournament_id: int
    team_id: int
    user_id: int
    name: str
    role: typing.Literal["tank", "dps", "support"] | None
    price: int
    division: int


class DashaTeam(BaseModel):
    id: int
    tournament_id: int
    name: str
    players: list[DashaTeamMember]
    avg_sr: float
    total_sr: int


class BalancerTeam(BaseModel):
    uuid: UUID4
    avg_sr: float = Field(alias="avgSr")
    name: str
    total_sr: int = Field(alias="totalSr")
    members: list[BalancerTeamMember]


class PlayerRead(BaseRead):
    name: str
    primary: bool
    secondary: bool
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
    avg_sr: float
    total_sr: int
    tournament_id: int
    captain_id: int
    tournament: TournamentRead | None
    players: list[PlayerRead]
    captain: UserRead | None
    placement: int | None
