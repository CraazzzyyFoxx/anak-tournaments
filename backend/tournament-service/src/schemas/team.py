from dataclasses import dataclass

from pydantic import UUID4, BaseModel, Field

from shared.schemas.role import RoleRef
from src.core import pagination
from src.schemas import BaseRead
from src.schemas.tournament import TournamentRead
from src.schemas.user_base import UserRead

__all__ = (
    "BalancerTeamMember",
    "BalancerTeam",
    "TeamRead",
    "PlayerRead",
    "TeamGroupRead",
    "TeamFilterQueryParams",
    "TeamFilterParams",
    "PlayerFilterQueryParams",
    "PlayerFilterParams",
)


class BalancerTeamMember(BaseModel):
    uuid: UUID4
    name: str
    sub_role: str | None = None
    role: RoleRef | None
    rank: int


class BalancerTeam(BaseModel):
    uuid: UUID4
    avg_sr: float = Field(alias="avgSr")
    name: str
    total_sr: int = Field(alias="totalSr")
    members: list[BalancerTeamMember]


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


class TeamGroupRead(BaseModel):
    """The group a team played in: a ``StageItem`` of type GROUP, name only."""

    id: int
    name: str


class TeamRead(BaseRead):
    name: str
    image_url: str | None = None
    avg_sr: float
    total_sr: int
    tournament_id: int
    captain_id: int | None
    tournament: TournamentRead | None
    players: list[PlayerRead]
    captain: UserRead | None
    placement: int | None
    group: TeamGroupRead | None


class TeamFilterQueryParams(pagination.PaginationSortQueryParams):
    tournament_id: int | None = None
    search: str | None = None


@dataclass
class TeamFilterParams(pagination.PaginationSortParams):
    tournament_id: int | None = None
    search: str | None = None


class PlayerFilterQueryParams(pagination.PaginationSortQueryParams):
    tournament_id: int | None = None
    team_id: int | None = None


@dataclass
class PlayerFilterParams(pagination.PaginationSortParams):
    tournament_id: int | None = None
    team_id: int | None = None


# PlayerRead.team is a forward reference to TeamRead, which is defined below it.
# Pydantic leaves such a model's serializer as a MockValSer placeholder and only
# tries to materialise it lazily on first use — and that lazy path fails with
# "'MockValSer' object cannot be converted to 'SchemaSerializer'" when the first
# use is a model_dump() reached through a cached/nested value rather than through
# validation. Rebuilding at import time makes it deterministic.
PlayerRead.model_rebuild()
TeamRead.model_rebuild()
