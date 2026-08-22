from pydantic import BaseModel

from shared.schemas.catalog import GamemodeRead

__all__ = (
    "OverfastGamemode",
    "GamemodeRead",
)


class OverfastGamemode(BaseModel):
    key: str
    name: str
    icon: str
    description: str
    screenshot: str
