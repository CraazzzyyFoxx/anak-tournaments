from pydantic import BaseModel

__all__ = (
    "GamemodeCreate",
    "GamemodeUpdate",
)


class GamemodeCreate(BaseModel):
    """Schema for creating a gamemode"""

    name: str


class GamemodeUpdate(BaseModel):
    """Schema for updating a gamemode"""

    name: str | None = None
