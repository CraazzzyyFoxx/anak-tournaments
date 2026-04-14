from datetime import datetime

from pydantic import BaseModel, Field

from src.schemas.base import BaseRead

__all__ = (
    "DivisionGridTierRead",
    "DivisionGridTierWrite",
    "DivisionGridVersionRead",
    "DivisionGridRead",
    "DivisionGridCreate",
    "DivisionGridVersionCreate",
    "DivisionGridVersionUpdate",
    "DivisionGridMappingRuleRead",
    "DivisionGridMappingRuleWrite",
    "DivisionGridMappingRead",
    "DivisionGridMappingWrite",
)


class DivisionGridTierRead(BaseRead):
    version_id: int
    slug: str
    number: int
    name: str
    sort_order: int
    rank_min: int
    rank_max: int | None
    icon_url: str


class DivisionGridVersionRead(BaseRead):
    grid_id: int
    version: int
    label: str
    status: str
    created_from_version_id: int | None
    published_at: datetime | None
    tiers: list[DivisionGridTierRead] = Field(default_factory=list)


class DivisionGridRead(BaseRead):
    workspace_id: int | None
    slug: str
    name: str
    description: str | None
    versions: list[DivisionGridVersionRead] = Field(default_factory=list)


class DivisionGridCreate(BaseModel):
    slug: str = Field(..., min_length=1, max_length=128)
    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = None


class DivisionGridVersionCreate(BaseModel):
    label: str = Field(..., min_length=1, max_length=255)
    tiers: list["DivisionGridTierWrite"] = Field(..., min_length=1)


class DivisionGridVersionUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=255)
    tiers: list["DivisionGridTierWrite"] | None = None


class DivisionGridTierWrite(BaseModel):
    slug: str = Field(..., min_length=1, max_length=128)
    number: int
    name: str = Field(..., min_length=1, max_length=255)
    sort_order: int
    rank_min: int
    rank_max: int | None
    icon_url: str = Field(..., min_length=1, max_length=2048)


class DivisionGridMappingRuleRead(BaseRead):
    mapping_id: int
    source_tier_id: int
    target_tier_id: int
    weight: float
    is_primary: bool


class DivisionGridMappingRuleWrite(BaseModel):
    source_tier_id: int
    target_tier_id: int
    weight: float = Field(..., gt=0)
    is_primary: bool = False


class DivisionGridMappingRead(BaseRead):
    source_version_id: int
    target_version_id: int
    name: str
    is_complete: bool
    rules: list[DivisionGridMappingRuleRead] = Field(default_factory=list)


class DivisionGridMappingWrite(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    rules: list[DivisionGridMappingRuleWrite] = Field(default_factory=list)


DivisionGridVersionCreate.model_rebuild()
DivisionGridVersionUpdate.model_rebuild()
