import typing
from uuid import uuid4

from pydantic import UUID4, BaseModel, ConfigDict, Field

from shared.domain.roster_shape import FLEX_SLOT_CODE, RosterSlotCode
from src.schemas import BaseRead
from src.schemas.tournament import TournamentRead
from src.schemas.user import UserRead

__all__ = (
    "BalancerTeamMember",
    "BalancerTeam",
    "InternalBalancerPlayer",
    "InternalBalancerTeam",
    "InternalBalancerTeamsPayload",
    "ChallongeTeamMapping",
    "ChallongeTeamSyncRequest",
    "ChallongeTeamPreviewTeam",
    "ChallongeTeamPreviewParticipant",
    "ChallongeTeamSyncPreview",
    "ChallongeTeamSyncResult",
    "TeamRead",
    "PlayerRead",
)


class BalancerTeamMember(BaseModel):
    uuid: str | UUID4
    name: str
    sub_role: str | None = None
    # A roster slot code, not a game role: ``flex`` is what a role-less roster
    # assigns, and the tournament player it creates carries HeroClass.flex.
    role: RosterSlotCode | None
    rank: int


class BalancerTeam(BaseModel):
    uuid: UUID4
    avg_sr: float = Field(alias="avgSr")
    name: str
    total_sr: int = Field(alias="totalSr")
    members: list[BalancerTeamMember]


class InternalBalancerPlayer(BaseModel):
    """Player schema for the internal balancer format (teams.json)."""

    model_config = ConfigDict(extra="allow")

    uuid: str | UUID4
    name: str
    rating: int
    discomfort: int | None = 0
    is_captain: bool = Field(default=False, alias="isCaptain")
    preferences: list[str] = []
    sub_role: str | None = Field(default=None, alias="subRole")
    all_ratings: dict[str, typing.Any] | None = Field(default=None, alias="allRatings")


class InternalBalancerTeam(BaseModel):
    """Team schema for the internal balancer format (teams.json)."""

    model_config = ConfigDict(extra="allow")

    id: int
    name: str
    avg_mmr: float = Field(alias="avgMMR")
    variance: float | None = None
    total_discomfort: int | None = Field(default=None, alias="totalDiscomfort")
    max_discomfort: int | None = Field(default=None, alias="maxDiscomfort")
    roster: dict[str, list[InternalBalancerPlayer]]

    @staticmethod
    def _map_role(role_name: str) -> RosterSlotCode | None:
        normalized = role_name.strip().lower()
        if normalized in {"damage", "dps"}:
            return "dps"
        if normalized == "support":
            return "support"
        if normalized == "tank":
            return "tank"
        if normalized == FLEX_SLOT_CODE:
            # A flex slot names no role; say so instead of dropping it to None,
            # which used to make the exported player look role-less by accident.
            return "flex"
        return None

    def to_balancer_team(self) -> BalancerTeam:
        members: list[BalancerTeamMember] = []
        total_sr = 0

        for roster_role, players in self.roster.items():
            mapped_role = self._map_role(roster_role)
            for player in players:
                total_sr += player.rating

                members.append(
                    BalancerTeamMember(
                        uuid=player.uuid,
                        name=player.name,
                        sub_role=player.sub_role,
                        role=mapped_role,
                        rank=player.rating,
                    )
                )

        return BalancerTeam(
            uuid=uuid4(),
            avgSr=self.avg_mmr,
            name=self.name,
            totalSr=total_sr,
            members=members,
        )


class InternalBalancerTeamsPayload(BaseModel):
    """Root schema for the internal balancer format (teams.json)."""

    model_config = ConfigDict(extra="allow")

    teams: list[InternalBalancerTeam]


class ChallongeTeamMapping(BaseModel):
    participant_id: int = Field(gt=0)
    group_id: int | None = None
    team_id: int = Field(gt=0)


class ChallongeTeamSyncRequest(BaseModel):
    mappings: list[ChallongeTeamMapping]


class ChallongeTeamPreviewTeam(BaseModel):
    id: int
    name: str
    balancer_name: str


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
