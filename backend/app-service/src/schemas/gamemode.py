from shared.schemas import catalog

__all__ = ("GamemodeRead",)


class GamemodeRead(catalog.GamemodeRead):
    aliases: list[str] = []
