"""Per-tournament captain match-report form: config read/write + submit validation.

The backend is the source of truth for what a captain must fill in; the frontend
mirrors these rules for UX only. Deliberately imports nothing from
``src.services.encounter.captain`` — the submit path imports *this* module.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.core import http_status as status
from shared.core.errors import BaseAPIException as HTTPException
from src import models
from src.schemas.encounter_report_form import (
    COMMENT_MAX_LENGTH,
    CUSTOM_TEXT_MAX_LENGTH,
    DEFAULT_BUILT_IN_FIELDS,
    REPORT_BUILT_IN_FIELDS,
    MatchReportFormRead,
    MatchReportFormUpsert,
    ReportBuiltInFieldConfig,
    ReportCustomFieldDefinition,
)

# One per-map code: (map_index 1-based, replay/match code string).
MapCodeInput = tuple[int, str]

# Series length assumed when an encounter has no ``best_of`` — mirrors the
# client's ``buildMapCodeSlots`` fallback in frontend/src/components/tournaments/
# matchReportSlots.ts. The two must agree or a captain sees fewer code slots than
# the server demands.
DEFAULT_BEST_OF = 3


@dataclass
class SanitizedSubmission:
    """A captain's submitted values after the tournament's config is applied.

    Values belonging to disabled fields are absent, not rejected, so a client
    holding a stale config cannot fail a submit it could not have known about.
    """

    closeness: int | None = None
    map_codes: list[MapCodeInput] = field(default_factory=list)
    comment: str | None = None
    custom_fields: dict[str, str] = field(default_factory=dict)


def _unprocessable(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=detail)


def series_map_indices(picked_orders: Iterable[int], best_of: int | None) -> list[int]:
    """The ``map_index`` slots a captain is offered a code field for.

    Server-side mirror of ``buildMapCodeSlots``: the veto pool's pick orders when
    a pool has picks, else ``1..best_of``.
    """
    picked = sorted(set(picked_orders))
    if picked:
        return picked
    count = best_of if best_of and best_of > 0 else DEFAULT_BEST_OF
    return list(range(1, count + 1))


async def get_report_form(
    session: AsyncSession,
    tournament_id: int,
) -> models.EncounterReportForm | None:
    result = await session.execute(
        select(models.EncounterReportForm).where(models.EncounterReportForm.tournament_id == tournament_id)
    )
    return result.scalar_one_or_none()


async def resolve_report_form(session: AsyncSession, tournament_id: int) -> MatchReportFormRead:
    """The tournament's effective config, with defaults filling every gap.

    Read-only: an absent row means "all defaults" and is NOT materialized here,
    so opening a report dialog never writes.
    """
    form = await get_report_form(session, tournament_id)
    return _merge_defaults(
        tournament_id,
        getattr(form, "built_in_fields_json", None) or {},
        getattr(form, "custom_fields_json", None) or [],
    )


async def upsert_report_form(
    session: AsyncSession,
    tournament_id: int,
    body: MatchReportFormUpsert,
) -> MatchReportFormRead:
    """Create-or-update the tournament's report form config. Commits internally."""
    form = await get_report_form(session, tournament_id)
    built_in_fields_json = {key: value.model_dump() for key, value in body.built_in_fields.items()}
    custom_fields_json = [definition.model_dump() for definition in body.custom_fields]

    if form is None:
        form = models.EncounterReportForm(
            tournament_id=tournament_id,
            built_in_fields_json=built_in_fields_json,
            custom_fields_json=custom_fields_json,
        )
        session.add(form)
    else:
        form.built_in_fields_json = built_in_fields_json
        form.custom_fields_json = custom_fields_json

    await session.commit()
    # Built from the validated body, not from ``form``: reading an attribute off
    # the just-committed instance would emit implicit IO (MissingGreenlet).
    return _merge_defaults(tournament_id, built_in_fields_json, custom_fields_json)


def _merge_defaults(
    tournament_id: int,
    built_in_raw: dict,
    custom_raw: list,
) -> MatchReportFormRead:
    """Merge a stored blob (if any) over the defaults. Stored keys win."""
    built_ins = {key: config.model_copy() for key, config in DEFAULT_BUILT_IN_FIELDS.items()}
    for key in REPORT_BUILT_IN_FIELDS:
        raw = built_in_raw.get(key)
        if raw is not None:
            built_ins[key] = ReportBuiltInFieldConfig.model_validate(raw)

    return MatchReportFormRead(
        tournament_id=tournament_id,
        built_in_fields=built_ins,
        custom_fields=[ReportCustomFieldDefinition.model_validate(raw or {}) for raw in custom_raw],
    )


def _config(form: MatchReportFormRead, name: str) -> ReportBuiltInFieldConfig:
    return form.built_in_fields.get(name) or DEFAULT_BUILT_IN_FIELDS[name]


def validate_submission(
    form: MatchReportFormRead,
    *,
    home_score: int,
    away_score: int,
    closeness: int | None,
    map_codes: Sequence[MapCodeInput],
    comment: str | None,
    custom_fields: dict[str, str] | None,
    available_map_indices: Sequence[int] = (),
) -> SanitizedSubmission:
    """Apply the tournament's config to one submission, or raise ``422``.

    Blank/absent values for optional fields are stored as NULL rather than as
    empty strings, so "not answered" and "answered with nothing" are one state.

    ``available_map_indices`` is the encounter's slot set from
    ``series_map_indices``; it bounds how many codes a required ``map_codes``
    config may demand.
    """
    sanitized = SanitizedSubmission()

    closeness_config = _config(form, "closeness")
    if closeness_config.enabled:
        if closeness is None:
            if closeness_config.required:
                raise _unprocessable("closeness is required")
        elif not 1 <= closeness <= 10:
            raise _unprocessable("closeness must be between 1 and 10")
        else:
            sanitized.closeness = closeness

    map_codes_config = _config(form, "map_codes")
    if map_codes_config.enabled:
        sanitized.map_codes = [(map_index, clean) for map_index, code in map_codes if (clean := (code or "").strip())]
        if map_codes_config.required:
            # One code per map actually PLAYED, not per best-of slot: a 2-0 Bo3
            # needs two codes and a 0-0 forfeit none. Clamped to the slots the
            # client actually offers (``series_map_indices``) — demanding a code
            # for a map the series does not have would be an unfixable 422.
            played = max(0, home_score + away_score)
            required = sorted(set(available_map_indices))[:played]
            supplied = {map_index for map_index, _code in sanitized.map_codes}
            if any(index not in supplied for index in required):
                raise _unprocessable("a match code is required for every played map")

    comment_config = _config(form, "comment")
    if comment_config.enabled:
        clean_comment = (comment or "").strip()
        if not clean_comment:
            if comment_config.required:
                raise _unprocessable("comment is required")
        elif len(clean_comment) > COMMENT_MAX_LENGTH:
            raise _unprocessable(f"comment must be at most {COMMENT_MAX_LENGTH} characters")
        else:
            sanitized.comment = clean_comment

    submitted = custom_fields or {}
    # Iterating the definitions (not the payload) drops keys the organizer has
    # since removed instead of failing the submit.
    for definition in form.custom_fields:
        value = (submitted.get(definition.key) or "").strip()
        if not value:
            if definition.required:
                raise _unprocessable(f'"{definition.label}" is required')
            continue
        if len(value) > CUSTOM_TEXT_MAX_LENGTH:
            raise _unprocessable(f'"{definition.label}" must be at most {CUSTOM_TEXT_MAX_LENGTH} characters')
        sanitized.custom_fields[definition.key] = value

    return sanitized
