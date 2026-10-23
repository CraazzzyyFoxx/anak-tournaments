from pydantic import BaseModel, ConfigDict, Field

from src.schemas.base import BaseRead
from src.schemas.division_grid import DivisionGridVersionRead

__all__ = (
    "WorkspaceRead",
    "WorkspaceCreate",
    "WorkspaceUpdate",
)


class WorkspaceRead(BaseRead):
    slug: str
    name: str
    description: str | None
    icon_url: str | None
    is_active: bool
    default_division_grid_versions: dict[str, int] = Field(default_factory=dict)
    effective_division_grid_versions: dict[str, DivisionGridVersionRead] = Field(default_factory=dict)


class WorkspaceCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    slug: str = Field(..., min_length=1, max_length=64, pattern=r"^[a-z0-9_-]+$")
    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    icon_url: str | None = None


class WorkspaceUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    description: str | None = None
    icon_url: str | None = None
    is_active: bool | None = None
