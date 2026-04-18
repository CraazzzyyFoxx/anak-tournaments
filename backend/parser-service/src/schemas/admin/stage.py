from typing import Literal

from pydantic import BaseModel, model_validator

from shared.core.enums import StageItemInputType, StageItemType, StageType

__all__ = (
    "StageCreate",
    "StageUpdate",
    "StageItemCreate",
    "StageItemInputCreate",
    "StageItemInputUpdate",
    "WireFromGroupsRequest",
    "SeedTeamsRequest",
)


class StageCreate(BaseModel):
    name: str
    description: str | None = None
    stage_type: StageType
    order: int = 0
    settings_json: dict | None = None
    challonge_id: int | None = None
    challonge_slug: str | None = None


class StageUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    stage_type: StageType | None = None
    order: int | None = None
    settings_json: dict | None = None


class StageItemCreate(BaseModel):
    name: str
    type: StageItemType
    order: int = 0


class StageItemInputCreate(BaseModel):
    slot: int
    input_type: StageItemInputType = StageItemInputType.EMPTY
    team_id: int | None = None
    source_stage_item_id: int | None = None
    source_position: int | None = None

    @model_validator(mode="after")
    def _validate_input_shape(self) -> "StageItemInputCreate":
        if self.input_type == StageItemInputType.FINAL and self.team_id is None:
            raise ValueError("FINAL inputs require team_id")
        if self.input_type == StageItemInputType.TENTATIVE:
            if self.source_stage_item_id is None or self.source_position is None:
                raise ValueError(
                    "TENTATIVE inputs require source_stage_item_id and source_position"
                )
            if self.team_id is not None:
                raise ValueError(
                    "TENTATIVE inputs must not have team_id (it is resolved on activation)"
                )
            if self.source_position < 1:
                raise ValueError("source_position is 1-based (>= 1)")
        return self


class StageItemInputUpdate(BaseModel):
    input_type: StageItemInputType | None = None
    team_id: int | None = None
    source_stage_item_id: int | None = None
    source_position: int | None = None


class WireFromGroupsRequest(BaseModel):
    """Auto-wire TENTATIVE inputs in a playoff stage from a group stage.

    ``top`` = number of teams advancing from each group (e.g. top=2 takes
    1st and 2nd place). Total slots wired = num_groups * top.

    ``mode`` = seeding pattern. "cross" avoids same-group rematches in R1
    by alternating direction per column; "snake" does plain top-down.
    """

    source_stage_id: int
    top: int = 2
    mode: Literal["cross", "snake"] = "cross"


class SeedTeamsRequest(BaseModel):
    """Distribute teams into a stage's stage_items (groups) automatically.

    ``mode`` selects the distribution strategy:
    - ``snake_sr`` (default) — sort by Team.avg_sr desc, snake-distribute
      across groups so each group ends up roughly equally strong.
    - ``by_total_sr`` — same but sorts by Team.total_sr (raw sum).
    - ``random`` — deterministic shuffle based on team.id (reproducible).
    """

    team_ids: list[int]
    mode: Literal["snake_sr", "by_total_sr", "random"] = "snake_sr"
