from pydantic import BaseModel

from src.schemas import BaseRead

__all__ = (
    "OverfastHero",
    "HeroRead",
)


class OverfastHero(BaseModel):
    key: str
    name: str
    portrait: str
    role: str


class HeroRead(BaseRead):
    slug: str
    name: str
    image_path: str
    type: str
    color: str
