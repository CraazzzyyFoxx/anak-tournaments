"""Wire contracts for the workspace player-sub-role catalog."""

from typing import Any

from pydantic import BaseModel

from shared.schemas.base import BaseRead

__all__ = (
    "PlayerSubRoleCreate",
    "PlayerSubRoleRead",
    "PlayerSubRoleUpdate",
)


class PlayerSubRoleRead(BaseRead):
    workspace_id: int
    discipline: str
    dimension: str
    role: str
    slug: str
    label: str
    description: str | None
    sort_order: int
    is_active: bool
    #: Raw presence of the stored keys (explicit ``null`` is a cleared presentation); ``icon`` is the public URL.
    attrs: dict[str, Any]


class PlayerSubRoleCreate(BaseModel):
    workspace_id: int
    discipline: str
    role: str
    label: str
    slug: str | None = None
    description: str | None = None
    sort_order: int = 0
    is_active: bool = True
    #: Omitted inherits the parent's presentation; an explicit ``null`` clears it.
    icon: str | None = None
    color: str | None = None


class PlayerSubRoleUpdate(BaseModel):
    role: str | None = None
    label: str | None = None
    slug: str | None = None
    description: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None
    icon: str | None = None
    color: str | None = None
