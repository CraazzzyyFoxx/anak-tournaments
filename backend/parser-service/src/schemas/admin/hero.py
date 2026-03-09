from pydantic import BaseModel

__all__ = (
    "HeroCreate",
    "HeroUpdate",
)


class HeroCreate(BaseModel):
    """Schema for creating a hero"""

    name: str
    role: str
    color: str | None = None


class HeroUpdate(BaseModel):
    """Schema for updating a hero"""

    name: str | None = None
    role: str | None = None
    color: str | None = None
