from shared.schemas import catalog
from src.schemas import GamemodeRead

__all__ = ("MapRead",)


class MapRead(catalog.MapRead):
    # Narrowed from the shared model so the nested gamemode carries app-service's
    # ``aliases`` too.
    gamemode: GamemodeRead | None
    aliases: list[str] = []
