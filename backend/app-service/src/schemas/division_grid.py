from pydantic import BaseModel, Field

__all__ = (
    "DivisionTierRead",
    "DivisionGridRead",
)


class DivisionTierRead(BaseModel):
    number: int
    name: str
    rank_min: int
    rank_max: int | None
    icon_path: str


class DivisionGridRead(BaseModel):
    tiers: list[DivisionTierRead] = Field(..., min_length=1)
