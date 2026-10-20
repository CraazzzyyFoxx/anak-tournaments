import typing
from uuid import uuid4

from pydantic import UUID4, BaseModel, ConfigDict, Field

from shared.domain.roster_shape import FLEX_SLOT_CODE
from shared.schemas.role import RoleRef

__all__ = (
    "BalancerTeamMember",
    "BalancerTeam",
    "InternalBalancerPlayer",
    "InternalBalancerTeam",
    "InternalBalancerTeamsPayload",
)


class BalancerTeamMember(BaseModel):
    uuid: str | UUID4
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


class InternalBalancerPlayer(BaseModel):
    """Player schema for the internal balancer format (teams.json)."""

    model_config = ConfigDict(extra="forbid")

    uuid: str | UUID4
    name: str
    assigned_rating: int
    role_discomfort: int | None = 0
    is_captain: bool = False
    role_preferences: list[str] = Field(default_factory=list)
    is_flex: bool = False
    sub_role: str | None = None
    all_ratings: dict[str, typing.Any] | None = None
    # Per-role discomfort snapshot the editor attaches to every player so it can
    # re-derive discomfort on drag-and-drop without re-running the solver. Mirror
    # of ``PlayerData.all_discomforts`` so the save round-trip accepts it.
    # Defaulted so payloads without it still validate.
    all_discomforts: dict[str, int] = Field(default_factory=dict)


class InternalBalancerTeam(BaseModel):
    """Team schema for the internal balancer format (teams.json)."""

    model_config = ConfigDict(extra="forbid")

    id: int
    name: str
    average_mmr: float
    rating_variance: float | None = None
    total_discomfort: int | None = None
    max_discomfort: int | None = None
    roster: dict[str, list[InternalBalancerPlayer]]
    format_violations: list[str] = Field(default_factory=list)
    format_advisories: list[str] = Field(default_factory=list)

    def to_balancer_team(self, dimension: str) -> BalancerTeam:
        members: list[BalancerTeamMember] = []
        total_sr = 0

        for roster_role, players in self.roster.items():
            code = roster_role.strip().lower()
            mapped_role = None if code == FLEX_SLOT_CODE else RoleRef(dimension=dimension, role=code)
            for player in players:
                total_sr += player.assigned_rating

                members.append(
                    BalancerTeamMember(
                        uuid=player.uuid,
                        name=player.name,
                        sub_role=player.sub_role,
                        role=mapped_role,
                        rank=player.assigned_rating,
                    )
                )

        return BalancerTeam(
            uuid=uuid4(),
            avgSr=self.average_mmr,
            name=self.name,
            totalSr=total_sr,
            members=members,
        )


class InternalBalancerTeamsPayload(BaseModel):
    """Root schema for the internal balancer format (teams.json)."""

    model_config = ConfigDict(extra="ignore")

    teams: list[InternalBalancerTeam]
