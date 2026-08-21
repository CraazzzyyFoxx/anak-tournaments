from pydantic import BaseModel

from shared.schemas import catalog

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


class GamemodeRead(catalog.GamemodeRead):
    aliases: list[str] = []
