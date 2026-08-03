"""Read models for captain reports and the admin reports list.

``serialize_captain_report`` used to hand-roll a dict, so the public
``GET /api/v1/encounters/{id}/reports`` had no response schema in the OpenAPI
manifest and documented as a generic object. One definition now serves both that
route and the admin list, which keeps the two from drifting.

The payload shape is unchanged from the hand-rolled dict — the frontend's
``CaptainReport`` type consumes it directly — except for the additive
``reporter_name``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from pydantic import BaseModel

from shared.core import pagination
from shared.core.enums import (
    EncounterResultAuditAction,
    EncounterResultStatus,
    EncounterStatus,
    StageType,
)

__all__ = (
    "CaptainReportRead",
    "EncounterMapCodeRead",
    "EncounterReportsQueryParams",
    "EncounterReportsRow",
    "EncounterReportsSearchParams",
    "EncounterReportsStats",
    "EncounterTeamRef",
    "LastResolutionRead",
    "valid_series_scores",
)


def valid_series_scores(best_of: int) -> set[tuple[int, int]]:
    """Every score a best-of-N series can legitimately end on.

    The winner reaches ``floor(N/2) + 1`` maps and the loser takes at most the
    rest; an even N may also be drawn down the middle (BO2 -> 1:1). Used to flag
    reports, never to reject them: reports predate per-round best-of, so a
    mismatch is information, not an error.
    """
    if best_of < 1:
        return set()
    wins_needed = best_of // 2 + 1
    losing_scores = range(best_of - wins_needed + 1)
    scores = {(wins_needed, loser) for loser in losing_scores}
    scores |= {(loser, wins_needed) for loser in losing_scores}
    if best_of % 2 == 0:
        scores.add((best_of // 2, best_of // 2))
    return scores


class EncounterMapCodeRead(BaseModel):
    id: int
    map_index: int
    map_id: int | None
    code: str


class CaptainReportRead(BaseModel):
    """One captain's independent report of an encounter's result."""

    id: int
    encounter_id: int
    team_id: int
    side: str | None
    reporter_user_id: int | None
    reporter_name: str | None = None
    home_score: int
    away_score: int
    closeness: int
    map_codes: list[EncounterMapCodeRead]
    created_at: str | None
    updated_at: str | None


class EncounterTeamRef(BaseModel):
    id: int
    name: str | None


class LastResolutionRead(BaseModel):
    """The newest audit row for the encounter, flattened for the list row."""

    action: EncounterResultAuditAction
    actor_user_id: int | None
    actor_name: str | None
    created_at: datetime


class EncounterReportsRow(BaseModel):
    """One encounter plus the pair of reports filed against it.

    The row, not the report, is the unit: a dispute spans two reports and the
    action that resolves it is per-encounter.
    """

    id: int
    name: str
    tournament_id: int
    tournament_name: str | None
    stage_name: str | None
    #: Lets the resolve dialog refuse a draw before sending it: an elimination
    #: bracket needs a winner and the finalizer rejects one with a 400.
    stage_type: StageType | None
    round: int
    best_of: int
    status: EncounterStatus
    result_status: EncounterResultStatus
    scheduled_at: datetime | None
    home_team: EncounterTeamRef | None
    away_team: EncounterTeamRef | None
    home_report: CaptainReportRead | None
    away_report: CaptainReportRead | None
    reported_count: int
    #: None until both sides have reported — "they disagree" and "only one has
    #: answered" are different states and the UI must not conflate them.
    scores_match: bool | None
    #: False when the reported score is impossible for this encounter's best_of.
    #: Advisory: reports predate per-round best-of.
    series_score_valid: bool
    last_resolution: LastResolutionRead | None


class EncounterReportsStats(BaseModel):
    """Server-computed counters behind the filter chips.

    Computed server-side so a chip never reflects only the current page.
    """

    by_result_status: dict[str, int]
    mismatch_count: int
    awaiting_second_count: int


class EncounterReportsQueryParams(pagination.PaginationSortSearchQueryParams):
    """Wire shape of the list's query string."""

    tournament_id: int | None = None
    stage_id: int | None = None
    result_status: list[EncounterResultStatus] = []
    mismatch_only: bool = False
    reported_count: int | None = None


@dataclass
class EncounterReportsSearchParams(pagination.PaginationSortSearchParams):
    """Parsed filters.

    Split into "scope" (tournament, stage, free text) and "chip" (result status,
    mismatch, reported count) by the service: the stats endpoint applies only
    the former, so a chip counts what it would select rather than what it has
    already selected.
    """

    tournament_id: int | None = None
    stage_id: int | None = None
    result_status: list[EncounterResultStatus] = field(default_factory=list)
    mismatch_only: bool = False
    reported_count: int | None = None
