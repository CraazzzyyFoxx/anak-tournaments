import typing
from uuid import uuid4

from pydantic import UUID4, BaseModel, ConfigDict, Field

from src.schemas.base import BaseRead

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
    role: typing.Literal["tank", "dps", "support"] | None
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
    def _map_role(role_name: str) -> typing.Literal["tank", "dps", "support"] | None:
        normalized = role_name.strip().lower()
        if normalized in {"damage", "dps"}:
            return "dps"
        if normalized == "support":
            return "support"
        if normalized == "tank":
            return "tank"
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
