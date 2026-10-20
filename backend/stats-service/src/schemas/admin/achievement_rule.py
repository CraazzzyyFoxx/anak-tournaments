"""Pydantic schemas for the achievement rule engine admin API."""

from __future__ import annotations

import typing
from dataclasses import dataclass
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from shared.schemas.discipline_filter import InstalledDisciplineFilter
from src.core import pagination

__all__ = (
    "AchievementRuleRead",
    "AchievementRuleCreate",
    "AchievementRuleUpdate",
    "AchievementRulePortable",
    "AchievementRuleExportWorkspace",
    "AchievementRuleExportEnvelope",
    "AchievementRuleImportResult",
    "AchievementImportWarning",
    "AchievementLibraryWorkspaceRead",
    "AchievementLibraryRuleRead",
    "AchievementLibraryImportRequest",
    "AchievementRuleListParams",
    "AchievementRuleListQueryParams",
    "ConditionTreeValidateRequest",
    "ConditionTreeValidateResponse",
    "EvaluationRunRead",
    "SeedResultRead",
    "HardResetResultRead",
    "EvaluateRequest",
    "OverrideCreate",
    "OverrideRead",
    "ConditionTypeInfo",
)


class AchievementRuleRead(BaseModel):
    id: int
    workspace_id: int
    slug: str
    name: str
    description_ru: str
    description_en: str
    image_url: str | None
    discipline: str
    entity_id: int | None
    category: str
    scope: str
    grain: str
    condition_tree: dict
    depends_on: list[str]
    enabled: bool
    rule_version: int
    min_tournament_id: int | None
    created_at: datetime
    updated_at: datetime | None


class _RuleWire(BaseModel):
    """A rule on a request: strict, and the retired ``hero_id`` is an explicit error, never an alias or a drop."""

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="before")
    @classmethod
    def _reject_hero_id(cls, data: typing.Any) -> typing.Any:
        if isinstance(data, dict) and "hero_id" in data:
            raise ValueError("hero_id is no longer supported; send entity_id (rule format v2)")
        return data


class AchievementRuleCreate(_RuleWire):
    slug: str
    name: str
    description_ru: str
    description_en: str
    image_url: str | None = None
    discipline: str
    entity_id: int | None = None
    category: str
    scope: str
    grain: str
    condition_tree: dict
    depends_on: list[str] = Field(default_factory=list)
    enabled: bool = True
    rule_version: int = 1
    min_tournament_id: int | None = None


_NOT_NULLABLE_ON_UPDATE = (
    "slug",
    "name",
    "description_ru",
    "description_en",
    "category",
    "scope",
    "grain",
    "condition_tree",
    "depends_on",
    "enabled",
    "rule_version",
)


class AchievementRuleUpdate(_RuleWire):
    """A partial update. Omitted means unchanged; explicit ``null`` is only meaningful for the nullable columns
    (``image_url``, ``entity_id``, ``min_tournament_id``) and an explicit ``{}`` tree is a real, empty tree."""

    slug: str | None = None
    name: str | None = None
    description_ru: str | None = None
    description_en: str | None = None
    image_url: str | None = None
    entity_id: int | None = None
    category: str | None = None
    scope: str | None = None
    grain: str | None = None
    condition_tree: dict | None = None
    depends_on: list[str] | None = None
    enabled: bool | None = None
    rule_version: int | None = None
    min_tournament_id: int | None = None

    @model_validator(mode="before")
    @classmethod
    def _reject_immutable_and_null(cls, data: typing.Any) -> typing.Any:
        if isinstance(data, dict):
            if "discipline" in data:
                raise ValueError("discipline is immutable; create a new rule in the other discipline")
            if nulls := [name for name in _NOT_NULLABLE_ON_UPDATE if name in data and data[name] is None]:
                raise ValueError(f"{', '.join(nulls)} cannot be null")
        return data


class AchievementRulePortable(_RuleWire):
    slug: str
    name: str
    description_ru: str
    description_en: str
    image_url: str | None = None
    discipline: str
    entity_id: int | None = None
    category: str
    scope: str
    grain: str
    condition_tree: dict
    depends_on: list[str] = Field(default_factory=list)
    enabled: bool = True
    rule_version: int = 1
    min_tournament_id: int | None = None

    @field_validator("image_url")
    @classmethod
    def _validate_image_url(cls, value: str | None) -> str | None:
        """First-line defense for the S3-IDOR import path (review C3).

        The authoritative key check lives server-side in
        ``import_export.find_workspace_achievement_asset_key``; this rejects the
        most obvious abuse (non-http(s) schemes, whitespace/control characters,
        embedded traversal) before it reaches that resolver.
        """
        if value is None:
            return None
        candidate = value.strip()
        if not candidate:
            return None
        if not (candidate.startswith("http://") or candidate.startswith("https://")):
            raise ValueError("image_url must be an absolute http(s) URL")
        if any(ch.isspace() for ch in candidate) or "\x00" in candidate:
            raise ValueError("image_url must not contain whitespace or control characters")
        if ".." in candidate.split("/"):
            raise ValueError("image_url must not contain path traversal segments")
        return candidate


class AchievementRuleExportWorkspace(BaseModel):
    id: int
    slug: str
    name: str


class AchievementRuleExportEnvelope(BaseModel):
    #: Portable format v2 (``discipline`` + ``entity_id``). v1 and its ``hero_id`` are refused, never converted.
    schema_version: typing.Literal[2]
    exported_at: datetime
    source_workspace: AchievementRuleExportWorkspace | None = None
    rules: list[AchievementRulePortable]

    @field_validator("schema_version", mode="before")
    @classmethod
    def _only_v2(cls, value: typing.Any) -> typing.Any:
        if value != 2:
            raise ValueError(
                f"unsupported schema_version {value!r}: only 2 is accepted; re-export from a current build"
            )
        return value


class AchievementImportWarning(BaseModel):
    slug: str
    message: str


class AchievementRuleImportResult(BaseModel):
    created: int
    updated: int
    warnings: list[AchievementImportWarning] = Field(default_factory=list)


class AchievementLibraryWorkspaceRead(BaseModel):
    id: int
    slug: str
    name: str
    rules_count: int


class AchievementLibraryRuleRead(BaseModel):
    slug: str
    name: str
    category: str
    enabled: bool
    image_url: str | None = None


class AchievementLibraryImportRequest(BaseModel):
    source_workspace_id: int
    discipline: str
    slugs: list[str] = Field(default_factory=list, min_length=1)


_RULE_SORT = typing.Literal["id", "name", "slug", "category", "enabled", "scope", "grain", "rule_version", "created_at"]


class AchievementRuleListQueryParams(pagination.PaginationSortQueryParams[_RULE_SORT]):
    per_page: int = Field(default=50, ge=-1, le=500)
    sort: _RULE_SORT = "category"
    #: One installed game's rules; absent is every game of the workspace (spec §8.1).
    discipline: InstalledDisciplineFilter = None
    search: str | None = None
    category: str | None = None
    enabled: bool | None = None


@dataclass
class AchievementRuleListParams(pagination.PaginationSortParams):
    per_page: int = 50
    discipline: str | None = None
    search: str | None = None
    category: str | None = None
    enabled: bool | None = None


class ConditionTreeValidateRequest(BaseModel):
    discipline: str
    condition_tree: dict


class ConditionTreeValidateResponse(BaseModel):
    valid: bool
    errors: list[str]
    inferred_grain: str | None = None


class EvaluationRunRead(BaseModel):
    id: str
    workspace_id: int
    trigger: str
    tournament_id: int | None
    rules_evaluated: int
    results_created: int
    results_removed: int
    started_at: datetime
    finished_at: datetime | None
    status: str
    error_message: str | None


class SeedResultRead(BaseModel):
    seeded: int
    removed: int = 0


class HardResetResultRead(BaseModel):
    seeded: int
    removed: int
    cleared_results: int
    run: EvaluationRunRead


class EvaluateRequest(BaseModel):
    discipline: str
    tournament_id: int | None = None
    rule_ids: list[int] | None = None


class OverrideCreate(BaseModel):
    achievement_rule_id: int
    user_id: int
    tournament_id: int | None = None
    match_id: int | None = None
    action: str  # "grant" or "revoke"
    reason: str


class OverrideRead(BaseModel):
    id: int
    achievement_rule_id: int
    user_id: int
    tournament_id: int | None
    match_id: int | None
    action: str
    reason: str
    granted_by: int
    created_at: datetime


class ConditionTypeInfo(BaseModel):
    name: str
    grain: str
    description: str
    required_params: list[str]
    optional_params: list[str]
    #: Source tables the node reads — what a rule's ``depends_on`` is derived from.
    depends_on: list[str] = Field(default_factory=list)
    #: Only usable inside a ``team_players_match``/``captain_property`` sub-tree.
    subcondition_only: bool = False
    #: Usable there, in addition to the top level.
    subcondition_ok: bool = False
