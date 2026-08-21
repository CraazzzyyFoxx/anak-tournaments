from pydantic import BaseModel

from shared.schemas import catalog
from src.schemas import GamemodeRead

__all__ = (
    "OverfastMap",
    "MapRead",
)


class OverfastMap(BaseModel):
    name: str
    screenshot: str
    gamemodes: list[str]
    location: str
    country_code: str | None


class MapRead(catalog.MapRead):
    # Narrowed from the shared model so the nested gamemode carries app-service's
    # ``aliases`` too.
    gamemode: GamemodeRead | None
    aliases: list[str] = []
