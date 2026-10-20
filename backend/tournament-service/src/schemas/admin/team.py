from pydantic import BaseModel, Field

from shared.schemas.role import RoleRef

__all__ = (
    "TeamCreate",
    "TeamUpdate",
    "PlayerCreate",
    "PlayerUpdate",
    "ChallongeTeamMapping",
    "ChallongeTeamSyncRequest",
    "ChallongeTeamPreviewTeam",
    "ChallongeTeamPreviewParticipant",
    "ChallongeTeamSyncPreview",
    "ChallongeTeamSyncResult",
)


class TeamCreate(BaseModel):
    name: str
    balancer_name: str | None = None
    tournament_id: int
    captain_id: int


class TeamUpdate(BaseModel):
    name: str | None = None
    balancer_name: str | None = None
    captain_id: int | None = None


class PlayerCreate(BaseModel):
    name: str
    user_id: int
    team_id: int
    tournament_id: int
    role: RoleRef | None = None
    rank: int = 0
    is_newcomer: bool = False
    is_newcomer_role: bool = False
    is_substitution: bool = False
    related_player_id: int | None = None


class PlayerUpdate(BaseModel):
    name: str | None = None
    role: RoleRef | None = None
    rank: int | None = None
    is_newcomer: bool | None = None
    is_newcomer_role: bool | None = None
    is_substitution: bool | None = None
    related_player_id: int | None = None


class ChallongeTeamMapping(BaseModel):
    participant_id: int = Field(gt=0)
    group_id: int | None = None
    team_id: int = Field(gt=0)


class ChallongeTeamSyncRequest(BaseModel):
    mappings: list[ChallongeTeamMapping]


class ChallongeTeamPreviewTeam(BaseModel):
    id: int
    name: str
    balancer_name: str | None


class ChallongeTeamPreviewParticipant(BaseModel):
    participant_id: int
    challonge_id: int
    group_id: int | None
    group_name: str | None
    challonge_tournament_id: int
    name: str
    active: bool
    suggested_team_id: int | None
    mapped_team_id: int | None


class ChallongeTeamSyncPreview(BaseModel):
    teams: list[ChallongeTeamPreviewTeam]
    participants: list[ChallongeTeamPreviewParticipant]


class ChallongeTeamSyncResult(BaseModel):
    success: bool
    count: int
    created: int
    updated: int
    unchanged: int
    skipped: int
    errors: list[str] = Field(default_factory=list)
