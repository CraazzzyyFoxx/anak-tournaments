from pydantic import BaseModel

from shared.core.enums import StageItemInputType, StageItemType, StageType

__all__ = (
    "StageCreate",
    "StageUpdate",
    "StageItemCreate",
    "StageItemInputCreate",
    "StageItemInputUpdate",
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


class StageItemInputUpdate(BaseModel):
    input_type: StageItemInputType | None = None
    team_id: int | None = None
    source_stage_item_id: int | None = None
    source_position: int | None = None
