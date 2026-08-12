from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from src.schemas.base import BaseRead

__all__ = (
    "DivisionGridTierRead",
    "DivisionGridTierWrite",
    "DivisionGridVersionRead",
    "DivisionGridRead",
    "DivisionGridCreate",
    "DivisionGridVersionCreate",
    "DivisionGridUpdate",
    "DivisionGridVersionUpdate",
    "DivisionGridMappingRuleRead",
    "DivisionGridMappingRuleWrite",
    "DivisionGridMappingRead",
    "DivisionGridMappingWrite",
    "DivisionGridMarketplaceWorkspaceRead",
    "DivisionGridMarketplaceVersionRead",
    "DivisionGridMarketplaceGridRead",
    "DivisionGridMarketplaceImportRequest",
    "DivisionGridMarketplacePreflightResult",
    "DivisionGridMarketplaceImportedGrid",
    "DivisionGridMarketplaceImportWarning",
    "DivisionGridMarketplaceImportResult",
    "DivisionGridImportJobRead",
    "DivisionGridActivationReadiness",
    "DivisionGridReadinessConflictTier",
    "DivisionGridReadinessSource",
    "DivisionGridSaveRequest",
    "DivisionGridSaveResult",
    "DivisionGridPortableVersion",
    "DivisionGridPortableMappingRule",
    "DivisionGridPortableMapping",
    "DivisionGridPortableDocument",
    "DivisionGridPortableImportRequest",
)


class DivisionGridTierRead(BaseRead):
    version_id: int
    slug: str
    number: int
    name: str
    sort_order: int
    rank_min: int
    rank_max: int | None
    icon_url: str
    ow_rank_min: int | None = None
    ow_rank_max: int | None = None


class DivisionGridVersionRead(BaseRead):
    grid_id: int
    version: int
    label: str
    status: str
    created_from_version_id: int | None
    published_at: datetime | None
    tiers: list[DivisionGridTierRead] = Field(default_factory=list)


class DivisionGridRead(BaseRead):
    workspace_id: int | None
    slug: str
    name: str
    description: str | None
    source_workspace_id: int | None = None
    source_grid_id: int | None = None
    source_key: str | None = None
    source_fingerprint: str | None = None
    imported_at: datetime | None = None
    archived_at: datetime | None = None
    versions: list[DivisionGridVersionRead] = Field(default_factory=list)


class DivisionGridCreate(BaseModel):
    slug: str = Field(..., min_length=1, max_length=128)
    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = None


class DivisionGridUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    archived: bool | None = None


class DivisionGridVersionCreate(BaseModel):
    label: str = Field(..., min_length=1, max_length=255)
    tiers: list["DivisionGridTierWrite"] = Field(..., min_length=1)


class DivisionGridVersionUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=255)
    tiers: list["DivisionGridTierWrite"] | None = None


class DivisionGridTierWrite(BaseModel):
    id: int | None = None
    slug: str = Field(..., min_length=1, max_length=128)
    number: int
    name: str = Field(..., min_length=1, max_length=255)
    sort_order: int
    rank_min: int
    rank_max: int | None
    icon_url: str = Field(..., min_length=1, max_length=2048)
    ow_rank_min: int | None = None
    ow_rank_max: int | None = None

    @field_validator("icon_url")
    @classmethod
    def _icon_url_scheme(cls, value: str) -> str:
        # Rendered as <img src>; only http(s) or site-relative paths are safe
        # (blocks javascript:/data: payloads).
        if value.startswith(("https://", "http://", "/")):
            return value
        raise ValueError("icon_url must be an http(s) URL or a site-relative path")


class DivisionGridMappingRuleRead(BaseRead):
    mapping_id: int
    source_tier_id: int
    target_tier_id: int
    weight: float
    is_primary: bool


class DivisionGridMappingRuleWrite(BaseModel):
    source_tier_id: int
    target_tier_id: int
    weight: float = Field(..., gt=0)
    is_primary: bool = False


class DivisionGridMappingRead(BaseRead):
    source_version_id: int
    target_version_id: int
    name: str
    is_complete: bool
    rules: list[DivisionGridMappingRuleRead] = Field(default_factory=list)


class DivisionGridMappingWrite(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    rules: list[DivisionGridMappingRuleWrite] = Field(default_factory=list)


class DivisionGridMarketplaceWorkspaceRead(BaseModel):
    id: int
    slug: str
    name: str
    grids_count: int
    versions_count: int


class DivisionGridMarketplaceVersionRead(BaseModel):
    id: int
    version: int
    label: str
    status: str
    tiers_count: int
    preview_icon_urls: list[str] = Field(default_factory=list)


class DivisionGridMarketplaceGridRead(BaseModel):
    id: int
    slug: str
    name: str
    description: str | None
    versions_count: int
    tiers_count: int
    preview_icon_urls: list[str] = Field(default_factory=list)
    versions: list[DivisionGridMarketplaceVersionRead] = Field(default_factory=list)


class DivisionGridMarketplaceImportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_workspace_id: int
    source_grid_id: int
    source_version_id: int
    include_icons: bool = True
    include_ow_rank_mappings: bool = True


class DivisionGridMarketplacePreflightResult(BaseModel):
    source_workspace_id: int
    grids_count: int
    versions_count: int
    tiers_count: int
    mappings_count: int
    assets_to_copy: int
    assets_to_reuse: int
    external_assets: int
    conflicts: list[str] = Field(default_factory=list)
    warnings: list["DivisionGridMarketplaceImportWarning"] = Field(default_factory=list)
    source_fingerprint: str


class DivisionGridMarketplaceImportedGrid(BaseModel):
    source_grid_id: int
    target_grid_id: int
    slug: str
    name: str
    versions_count: int
    tiers_count: int


class DivisionGridMarketplaceImportWarning(BaseModel):
    grid_slug: str | None = None
    message: str


class DivisionGridMarketplaceImportResult(BaseModel):
    created_grids: int
    created_versions: int
    created_tiers: int
    copied_images: int
    copied_mappings: int
    imported_grids: list[DivisionGridMarketplaceImportedGrid] = Field(default_factory=list)
    warnings: list[DivisionGridMarketplaceImportWarning] = Field(default_factory=list)


class DivisionGridImportJobRead(BaseModel):
    id: int
    workspace_id: int
    source_workspace_id: int | None
    requested_by_user_id: int | None = None
    status: Literal["pending", "running", "completed", "failed"]
    progress: int = Field(..., ge=0, le=100)
    result: DivisionGridMarketplaceImportResult | None = None
    error: str | None = None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None


class DivisionGridReadinessConflictTier(BaseModel):
    source_tier_id: int
    slug: str
    name: str


class DivisionGridReadinessSource(BaseModel):
    version_id: int
    version_label: str
    grid_name: str
    tournament_count: int = 0
    tournament_names: list[str] = Field(default_factory=list)
    status: Literal["ok", "missing", "incomplete"]
    conflict_tiers: list[DivisionGridReadinessConflictTier] = Field(default_factory=list)


class DivisionGridActivationReadiness(BaseModel):
    target_version_id: int
    is_ready: bool
    used_source_version_ids: list[int] = Field(default_factory=list)
    missing_mapping_version_ids: list[int] = Field(default_factory=list)
    incomplete_mapping_version_ids: list[int] = Field(default_factory=list)
    sources: list[DivisionGridReadinessSource] = Field(default_factory=list)


class DivisionGridSaveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    grid_id: int | None = None
    name: str | None = Field(default=None, min_length=1, max_length=255)
    tiers: list[DivisionGridTierWrite] = Field(..., min_length=1)


class DivisionGridSaveResult(BaseModel):
    mode: Literal["in_place", "new_version_activated", "new_version_pending"]
    grid: DivisionGridRead
    active_version_id: int | None = None
    saved_version_id: int
    readiness: DivisionGridActivationReadiness


class DivisionGridPortableVersion(BaseModel):
    version: int
    label: str
    status: Literal["draft", "published"]
    tiers: list[DivisionGridTierWrite] = Field(..., min_length=1)


class DivisionGridPortableMappingRule(BaseModel):
    source_tier_slug: str
    target_tier_slug: str
    weight: float = Field(..., gt=0)
    is_primary: bool = False


class DivisionGridPortableMapping(BaseModel):
    source_version: int
    target_version: int
    name: str
    rules: list[DivisionGridPortableMappingRule] = Field(default_factory=list)


class DivisionGridPortableDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["division-grid/v1"] = "division-grid/v1"
    slug: str = Field(..., min_length=1, max_length=128)
    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    versions: list[DivisionGridPortableVersion] = Field(..., min_length=1)
    mappings: list[DivisionGridPortableMapping] = Field(default_factory=list)


class DivisionGridPortableImportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document: DivisionGridPortableDocument
    mode: Literal["library", "sync", "copy"] = "library"


DivisionGridVersionCreate.model_rebuild()
DivisionGridVersionUpdate.model_rebuild()
DivisionGridMarketplacePreflightResult.model_rebuild()
