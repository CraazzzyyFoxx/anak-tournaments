from pydantic import BaseModel

from shared.schemas.catalog import HeroRead

__all__ = (
    "OverfastHero",
    "HeroRead",
)


class OverfastHero(BaseModel):
    key: str
    name: str
    portrait: str
    role: str
