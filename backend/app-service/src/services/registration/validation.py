"""Validation helpers for public registration submissions."""

from __future__ import annotations

import re
from typing import Any

from fastapi import HTTPException, status

from src.schemas.registration import (
    BuiltInFieldConfig,
    CustomFieldDefinition,
    RegistrationCreate,
    RegistrationUpdate,
)

BATTLE_TAG_FIELDS = {"battle_tag", "smurf_tags"}
TEXTUAL_CUSTOM_FIELD_TYPES = {"text", "number", "url"}


def _canonicalize_battle_tag(value: str | None) -> str:
    text = (value or "").strip()
    text = re.sub(r"\s*#\s*", "#", text)
    return text.replace(" ", "").strip()


def _coerce_built_in_field_config(value: Any) -> BuiltInFieldConfig:
    if isinstance(value, BuiltInFieldConfig):
        return value
    return BuiltInFieldConfig.model_validate(value or {})


def _coerce_custom_field_definition(value: Any) -> CustomFieldDefinition:
    if isinstance(value, CustomFieldDefinition):
        return value
    return CustomFieldDefinition.model_validate(value or {})


def _compile_fullmatch_pattern(pattern: str | None) -> re.Pattern[str] | None:
    if pattern is None:
        return None
    normalized = pattern.strip()
    if not normalized:
        return None
    return re.compile(normalized)


def _validation_error(
    message: str,
) -> None:
    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=message)


def _matches_pattern(pattern: re.Pattern[str] | None, value: str) -> bool:
    if pattern is None:
        return True
    return pattern.fullmatch(value) is not None


def _validate_required_text(
    *,
    value: str | None,
    label: str,
) -> None:
    if (value or "").strip():
        return
    _validation_error(f"{label} is required.")


def _validate_required_list(
    *,
    values: list[str] | None,
    label: str,
) -> None:
    if values:
        return
    _validation_error(f"{label} is required.")


def _validate_string_pattern(
    *,
    value: str | None,
    config: BuiltInFieldConfig | CustomFieldDefinition,
    label: str,
    normalize_battle_tag: bool = False,
) -> None:
    raw_value = (value or "").strip()
    if not raw_value:
        return

    validation = config.validation
    pattern = _compile_fullmatch_pattern(validation.regex if validation else None)
    if pattern is None:
        return

    candidate = _canonicalize_battle_tag(raw_value) if normalize_battle_tag else raw_value
    if _matches_pattern(pattern, candidate):
        return

    _validation_error(validation.error_message or f"{label} format is invalid.")


def _validate_list_pattern(
    *,
    values: list[str] | None,
    config: BuiltInFieldConfig,
    label: str,
) -> None:
    if not values:
        return

    validation = config.validation
    pattern = _compile_fullmatch_pattern(validation.regex if validation else None)
    if pattern is None:
        return

    for value in values:
        candidate = _canonicalize_battle_tag(value)
        if candidate and _matches_pattern(pattern, candidate):
            continue
        _validation_error(validation.error_message or f"{label} format is invalid.")


def _validate_checkbox_requirement(
    *,
    value: Any,
    field: CustomFieldDefinition,
) -> None:
    if value is not None and value != "":
        return
    _validation_error(f"Fill in the required field: {field.label}.")


def _validate_custom_field(
    *,
    field: CustomFieldDefinition,
    value: Any,
    provided: bool,
    partial: bool,
) -> None:
    if partial and not provided:
        return

    if field.required:
        if field.type == "checkbox":
            _validate_checkbox_requirement(value=value, field=field)
        elif not str(value or "").strip():
            _validation_error(f"Fill in the required field: {field.label}.")

    if field.type not in TEXTUAL_CUSTOM_FIELD_TYPES:
        return

    _validate_string_pattern(
        value=None if value is None else str(value),
        config=field,
        label=field.label,
    )


def validate_registration_input(
    form: Any,
    payload: RegistrationCreate | RegistrationUpdate,
    *,
    partial: bool = False,
) -> None:
    built_in_fields = {
        key: _coerce_built_in_field_config(value)
        for key, value in (getattr(form, "built_in_fields_json", None) or {}).items()
    }
    custom_fields = [
        _coerce_custom_field_definition(value)
        for value in (getattr(form, "custom_fields_json", None) or [])
    ]
    provided_fields = payload.model_fields_set if partial else None

    built_in_payload_values: dict[str, Any] = {
        "battle_tag": getattr(payload, "battle_tag", None),
        "smurf_tags": getattr(payload, "smurf_tags", None),
        "discord_nick": getattr(payload, "discord_nick", None),
        "twitch_nick": getattr(payload, "twitch_nick", None),
        "notes": getattr(payload, "notes", None),
        "stream_pov": getattr(payload, "stream_pov", None),
        "roles": getattr(payload, "roles", None),
    }

    for field_key, label in (
        ("battle_tag", "BattleTag"),
        ("smurf_tags", "Smurf Accounts"),
        ("discord_nick", "Discord"),
        ("twitch_nick", "Twitch"),
        ("notes", "Notes"),
    ):
        config = built_in_fields.get(field_key)
        if config is None or not config.enabled:
            continue
        if partial and provided_fields is not None and field_key not in provided_fields:
            continue

        value = built_in_payload_values[field_key]
        if config.required:
            if field_key == "smurf_tags":
                _validate_required_list(values=value, label=label)
            else:
                _validate_required_text(value=value, label=label)

        if field_key == "smurf_tags":
            _validate_list_pattern(values=value, config=config, label=label)
        else:
            _validate_string_pattern(
                value=value,
                config=config,
                label=label,
                normalize_battle_tag=field_key in BATTLE_TAG_FIELDS,
            )

    primary_role_config = built_in_fields.get("primary_role")
    if primary_role_config and primary_role_config.enabled and primary_role_config.required:
        if not partial or (provided_fields is not None and "roles" in provided_fields):
            roles = built_in_payload_values["roles"] or []
            if not any(getattr(role, "is_primary", False) for role in roles):
                _validation_error("Primary Role is required.")

    additional_roles_config = built_in_fields.get("additional_roles")
    if additional_roles_config and additional_roles_config.enabled and additional_roles_config.required:
        if not partial or (provided_fields is not None and "roles" in provided_fields):
            roles = built_in_payload_values["roles"] or []
            if not any(not getattr(role, "is_primary", False) for role in roles):
                _validation_error("At least one additional role is required.")

    custom_values = getattr(payload, "custom_fields", None) or {}
    if not isinstance(custom_values, dict):
        custom_values = {}

    for field in custom_fields:
        provided = field.key in custom_values
        _validate_custom_field(
            field=field,
            value=custom_values.get(field.key),
            provided=provided,
            partial=partial,
        )
