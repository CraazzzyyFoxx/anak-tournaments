"""Pydantic schemas for tournament registration."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Registration form (config)
# ---------------------------------------------------------------------------


class CustomFieldDefinition(BaseModel):
    key: str
    label: str
    type: Literal["text", "number", "select", "checkbox", "url"] = "text"
    required: bool = False
    placeholder: str | None = None
    options: list[str] | None = None


class BuiltInFieldConfig(BaseModel):
    enabled: bool = True
    required: bool = False
    subroles: dict[str, list[str]] | None = None


class RegistrationFormRead(BaseModel):
    id: int
    tournament_id: int
    workspace_id: int
    is_open: bool
    auto_approve: bool = False
    opens_at: datetime | None = None
    closes_at: datetime | None = None
    built_in_fields: dict[str, BuiltInFieldConfig] = Field(default_factory=dict)
    custom_fields: list[CustomFieldDefinition] = Field(default_factory=list)


class RegistrationFormUpsert(BaseModel):
    is_open: bool = False
    opens_at: datetime | None = None
    closes_at: datetime | None = None
    custom_fields: list[CustomFieldDefinition] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Registration (public user-facing)
# ---------------------------------------------------------------------------


class RoleWithSubrole(BaseModel):
    role: str
    subrole: str | None = None
    is_primary: bool = False


class RegistrationCreate(BaseModel):
    battle_tag: str | None = None
    smurf_tags: list[str] | None = None
    discord_nick: str | None = None
    twitch_nick: str | None = None
    roles: list[RoleWithSubrole] | None = None
    stream_pov: bool = False
    notes: str | None = None
    custom_fields: dict[str, Any] | None = None


class RegistrationUpdate(BaseModel):
    battle_tag: str | None = None
    discord_nick: str | None = None
    twitch_nick: str | None = None
    primary_role: str | None = None
    stream_pov: bool | None = None
    notes: str | None = None
    custom_fields: dict[str, Any] | None = None


class RegistrationRoleRead(BaseModel):
    role: str
    subrole: str | None = None
    is_primary: bool = False
    priority: int = 0


class RegistrationRead(BaseModel):
    id: int
    tournament_id: int
    workspace_id: int
    auth_user_id: int | None = None
    user_id: int | None = None
    battle_tag: str | None = None
    smurf_tags_json: list[str] | None = None
    discord_nick: str | None = None
    twitch_nick: str | None = None
    stream_pov: bool = False
    roles: list[RegistrationRoleRead] = Field(default_factory=list)
    notes: str | None = None
    custom_fields_json: dict[str, Any] | None = None
    status: str = "pending"
    submitted_at: datetime | None = None
    reviewed_at: datetime | None = None


class RegistrationStatusResponse(BaseModel):
    status: str
    message: str
