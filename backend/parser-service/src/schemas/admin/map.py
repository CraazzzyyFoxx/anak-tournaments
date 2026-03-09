from pydantic import BaseModel

__all__ = (
    "MapCreate",
    "MapUpdate",
)


class MapCreate(BaseModel):
    """Schema for creating a map"""

    name: str
    gamemode_id: int


class MapUpdate(BaseModel):
    """Schema for updating a map"""

    name: str | None = None
    gamemode_id: int | None = None
