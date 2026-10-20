"""The wire of a team format: an organizer writes it, every reader gets it with its slot projection."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from shared.domain.roles import Ontology
from shared.domain.team_format import FormatDimension, FormatRule, TeamFormat, slot_shape
from shared.schemas.role import RoleRef
from shared.schemas.roster_slots import RosterShapeRead

__all__ = ("FormatDimensionWire", "FormatRuleWire", "TeamFormatRead", "TeamFormatWrite")

FormatSourceWire = Literal["tournament", "custom_game", "workspace", "preset"]


class FormatDimensionWire(BaseModel):
    dimension: str
    mode: Literal["off", "informational", "preference", "enforced"]
    player_min_assignments: int | None = Field(default=None, ge=0)
    player_max_assignments: int | None = Field(default=None, ge=0)


class FormatRuleWire(BaseModel):
    role: RoleRef
    hard_min: int | None = Field(default=None, ge=0)
    hard_max: int | None = Field(default=None, ge=0)
    recommended_min: int | None = Field(default=None, ge=0)
    recommended_max: int | None = Field(default=None, ge=0)
    include_descendants: bool = True


class TeamFormatWrite(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    preset_code: str | None = Field(default=None, max_length=64)
    starter_min: int = Field(ge=1)
    starter_max: int = Field(ge=1)
    substitute_min: int = Field(default=0, ge=0)
    substitute_max: int = Field(default=0, ge=0)
    dimensions: list[FormatDimensionWire] = Field(default_factory=list)
    rules: list[FormatRuleWire] = Field(default_factory=list)

    def to_domain(self, discipline: str) -> TeamFormat:
        return TeamFormat(
            discipline=discipline,
            name=self.name.strip(),
            starter_min=self.starter_min,
            starter_max=self.starter_max,
            substitute_min=self.substitute_min,
            substitute_max=self.substitute_max,
            dimensions=tuple(
                FormatDimension(entry.dimension, entry.mode, entry.player_min_assignments, entry.player_max_assignments)
                for entry in self.dimensions
            ),
            rules=tuple(
                FormatRule(
                    rule.role.dimension,
                    rule.role.role,
                    rule.hard_min,
                    rule.hard_max,
                    rule.recommended_min,
                    rule.recommended_max,
                    rule.include_descendants,
                )
                for rule in self.rules
            ),
            preset_code=self.preset_code,
        )


class TeamFormatRead(TeamFormatWrite):
    discipline: str
    source: FormatSourceWire
    #: The slot projection the balancer and the draft fill.
    roster_shape: RosterShapeRead

    @classmethod
    def from_domain(cls, team_format: TeamFormat, *, source: str, ontology: Ontology) -> TeamFormatRead:
        return cls(
            name=team_format.name,
            preset_code=team_format.preset_code,
            starter_min=team_format.starter_min,
            starter_max=team_format.starter_max,
            substitute_min=team_format.substitute_min,
            substitute_max=team_format.substitute_max,
            dimensions=[
                FormatDimensionWire(
                    dimension=entry.dimension,
                    mode=entry.mode,  # type: ignore[arg-type]  # checked on write
                    player_min_assignments=entry.player_min_assignments,
                    player_max_assignments=entry.player_max_assignments,
                )
                for entry in team_format.dimensions
            ],
            rules=[
                FormatRuleWire(
                    role=RoleRef.of_node(ontology, ontology.node(rule.dimension, rule.role)),
                    hard_min=rule.hard_min,
                    hard_max=rule.hard_max,
                    recommended_min=rule.recommended_min,
                    recommended_max=rule.recommended_max,
                    include_descendants=rule.include_descendants,
                )
                for rule in team_format.rules
            ],
            discipline=team_format.discipline,
            source=source,  # type: ignore[arg-type]  # a FormatSource
            roster_shape=RosterShapeRead.from_shape(
                slot_shape(team_format, ontology), source=source, dimension=ontology.rated.code
            ),
        )
