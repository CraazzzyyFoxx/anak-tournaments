"""Public catalog payloads that are not the OW-shaped hero/map/gamemode reads."""

from pydantic import BaseModel

__all__ = ("CatalogLegacyRead",)


class CatalogLegacyRead(BaseModel):
    """What an old ``overwatch.hero|map|gamemode`` id became (D84)."""

    entity_id: int
    discipline: str
    kind: str
    slug: str
