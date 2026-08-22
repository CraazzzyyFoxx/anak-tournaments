from pydantic import BaseModel

from shared.schemas.catalog import MapRead

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
