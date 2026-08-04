"""Wire shapes for the per-tournament captain match-report form config.

Mirrors ``src.schemas.registration``'s ``built_in_fields`` + ``custom_fields``
split so the admin builder page and the public read share one payload. The read
model is used verbatim for the admin GET, the admin PUT response and the
``form`` sibling of the public reports envelope.

``home_score``/``away_score`` are deliberately absent: they are the input to
result derivation, so a report without a score is meaningless.
"""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator

__all__ = (
    "COMMENT_MAX_LENGTH",
    "CUSTOM_TEXT_MAX_LENGTH",
    "DEFAULT_BUILT_IN_FIELDS",
    "MAX_CUSTOM_FIELDS",
    "REPORT_BUILT_IN_FIELDS",
    "MatchReportFormRead",
    "MatchReportFormUpsert",
    "ReportBuiltInFieldConfig",
    "ReportCustomFieldDefinition",
)

# Configurable built-in fields, in render order.
REPORT_BUILT_IN_FIELDS: tuple[str, ...] = ("closeness", "map_codes", "comment")

# Fixed caps rather than per-field knobs: one less thing to validate on both sides.
COMMENT_MAX_LENGTH = 1000
CUSTOM_TEXT_MAX_LENGTH = 500
MAX_CUSTOM_FIELDS = 20

LABEL_MAX_LENGTH = 64

CUSTOM_FIELD_KEY_PATTERN = re.compile(r"^[a-z][a-z0-9_]{0,31}$")

# Keys that would collide with a built-in report field on the wire.
RESERVED_CUSTOM_FIELD_KEYS = frozenset(
    {"home_score", "away_score", "score", "closeness", "map_codes", "comment"}
)


class ReportBuiltInFieldConfig(BaseModel):
    enabled: bool = True
    required: bool = False


class ReportCustomFieldDefinition(BaseModel):
    key: str
    label: str
    type: Literal["text"] = "text"
    required: bool = False
    placeholder: str | None = None


# Applied to any built-in key the stored blob does not carry, so a partial or
# absent row still reads as a complete config.
DEFAULT_BUILT_IN_FIELDS: dict[str, ReportBuiltInFieldConfig] = {
    "closeness": ReportBuiltInFieldConfig(enabled=True, required=True),
    "map_codes": ReportBuiltInFieldConfig(enabled=True, required=False),
    "comment": ReportBuiltInFieldConfig(enabled=True, required=False),
}


class MatchReportFormRead(BaseModel):
    tournament_id: int
    built_in_fields: dict[str, ReportBuiltInFieldConfig] = Field(default_factory=dict)
    custom_fields: list[ReportCustomFieldDefinition] = Field(default_factory=list)


class MatchReportFormUpsert(BaseModel):
    built_in_fields: dict[str, ReportBuiltInFieldConfig] = Field(default_factory=dict)
    custom_fields: list[ReportCustomFieldDefinition] = Field(default_factory=list)

    @field_validator("built_in_fields")
    @classmethod
    def _known_built_ins(
        cls, value: dict[str, ReportBuiltInFieldConfig]
    ) -> dict[str, ReportBuiltInFieldConfig]:
        """Reject unknown keys rather than storing config nothing will ever read."""
        unknown = sorted(set(value) - set(REPORT_BUILT_IN_FIELDS))
        if unknown:
            raise ValueError(f"unknown built-in report fields: {', '.join(unknown)}")
        return value

    @field_validator("custom_fields")
    @classmethod
    def _validate_custom_fields(
        cls, value: list[ReportCustomFieldDefinition]
    ) -> list[ReportCustomFieldDefinition]:
        if len(value) > MAX_CUSTOM_FIELDS:
            raise ValueError(f"at most {MAX_CUSTOM_FIELDS} custom fields are allowed")

        seen: set[str] = set()
        for field in value:
            if not CUSTOM_FIELD_KEY_PATTERN.fullmatch(field.key):
                raise ValueError(
                    f'custom field key "{field.key}" must match ^[a-z][a-z0-9_]{{0,31}}$'
                )
            if field.key in RESERVED_CUSTOM_FIELD_KEYS:
                raise ValueError(f'custom field key "{field.key}" is reserved')
            if field.key in seen:
                raise ValueError(f'duplicate custom field key "{field.key}"')
            seen.add(field.key)

            label = field.label.strip()
            if not label:
                raise ValueError(f'custom field "{field.key}" must have a label')
            if len(label) > LABEL_MAX_LENGTH:
                raise ValueError(
                    f'custom field "{field.key}" label must be at most {LABEL_MAX_LENGTH} characters'
                )
            field.label = label

            if field.placeholder is not None:
                field.placeholder = field.placeholder.strip() or None

        return value
