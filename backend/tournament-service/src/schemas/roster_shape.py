from typing import Literal

from pydantic import BaseModel

from shared.domain.roster_shape import RosterShape

__all__ = ("RosterShapeRead",)


class RosterShapeRead(BaseModel):
    """A resolved roster shape. The frontend never recomputes the fallback chain."""

    slots: dict[str, int]
    team_size: int
    flex_slots: int
    has_role_slots: bool
    draft_rounds: int
    source: Literal["tournament", "workspace", "default"]

    @classmethod
    def from_shape(cls, shape: RosterShape, *, source: str) -> "RosterShapeRead":
        """Project a domain shape, keeping every derived value on one payload.

        ``source`` names the level the value is STORED at, not what it resolved
        to: an override equal to the inherited default is still an override.
        ``shape.slots`` hands back a fresh ``dict`` (never the module-level
        ``MappingProxyType``), so the field serializes as a plain JSON object.
        """
        return cls(
            slots=shape.slots,
            team_size=shape.team_size,
            flex_slots=shape.flex_slots,
            has_role_slots=shape.has_role_slots,
            draft_rounds=shape.draft_rounds,
            source=source,  # type: ignore[arg-type]  # validated by the Literal
        )
