"""The Pydantic projection of a team format for slot readers."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

from shared.domain.roster_shape import RosterShape

__all__ = ("RosterShapeRead",)


class RosterShapeRead(BaseModel):
    """A team format's slots. The frontend never recomputes them."""

    #: The rated dimension the slot codes are roles of; ``flex`` counts the open slots (not a role).
    dimension: str | None = None
    slots: dict[str, int]
    team_size: int
    flex_slots: int
    has_role_slots: bool
    draft_rounds: int
    #: Which format the slots come from: the owner's own copy, the workspace default, or the module preset.
    source: Literal["tournament", "custom_game", "workspace", "preset"] | None = None

    @classmethod
    def from_shape(
        cls, shape: RosterShape, *, source: str | None = None, dimension: str | None = None
    ) -> RosterShapeRead:
        return cls(
            dimension=dimension,
            slots=shape.slots,
            team_size=shape.team_size,
            flex_slots=shape.flex_slots,
            has_role_slots=shape.has_role_slots,
            draft_rounds=shape.draft_rounds,
            source=source,  # type: ignore[arg-type]  # validated by the Literal
        )
