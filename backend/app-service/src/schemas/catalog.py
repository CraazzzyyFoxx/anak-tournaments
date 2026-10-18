"""Public catalog payloads: the shared native entity read and the legacy-id resolution."""

from pydantic import BaseModel

from shared.schemas.catalog import CatalogEntityRead

__all__ = ("CatalogEntityRead", "CatalogLegacyRead")


class CatalogLegacyRead(BaseModel):
    """What an old ``overwatch.hero|map|gamemode`` id became (D84)."""

    entity_id: int
    discipline: str
    kind: str
    slug: str
