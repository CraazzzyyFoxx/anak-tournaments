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

from pydantic import BaseModel, Field

from shared.core import pagination
from shared.core.enums import (
    EncounterResultAuditAction,
    EncounterResultStatus,
    EncounterStatus,
    StageType,
)

__all__ = (
    "EncounterParticipationRef",
    "EncounterReportsQueryParams",
    "EncounterReportsRow",
    "EncounterReportsSearchParams",
    "EncounterReportsStats",
    "EncounterTeamRef",
    "LastResolutionRead",
    "ReplayCodeRead",
    "TeamReportRead",
    "TeamReportResultRead",
)


class TeamReportResultRead(BaseModel):
    """One participation's line inside one report."""

    encounter_team_id: int
    score: float
    placement: int | None = None
    wins: int | None = None


class TeamReportRead(BaseModel):
    """One participation's independent report of an encounter's result."""

    id: int
    encounter_id: int
    encounter_team_id: int
    reporter_user_id: int | None
    reporter_name: str | None = None
    #: Draws included; NULL only on reports carried over by the migration.
    games_played: int | None
    #: The ``encounter.result_version`` the report was filed against.
    basis_version: int
    closeness: int | None
    comment: str | None = None
    custom_fields: dict[str, str] = Field(default_factory=dict)
    results: list[TeamReportResultRead] = Field(default_factory=list)
    created_at: str | None
    updated_at: str | None


class ReplayCodeRead(BaseModel):
    """One participation's replay code for one position (``game_team.replay_code``).

    ``encounter_team_id`` is the participation; its slot comes from the row's
    ``participations``."""

    position: int
    encounter_team_id: int
    code: str


class EncounterParticipationRef(BaseModel):
    """One live seat of an encounter, as a list row names it."""

    encounter_team_id: int
    slot: int
    team_id: int | None
    name: str


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
    """One encounter plus every report filed against it.

    The row, not the report, is the unit: a dispute spans the reports of all of
    an encounter's participations and the action that resolves it is
    per-encounter.
    """

    id: int
    name: str
    tournament_id: int
    tournament_name: str | None
    stage_name: str | None
    #: Lets the resolve dialog refuse a draw before sending it: an elimination
    #: bracket needs a winner and the finalizer rejects one with a 400.
    stage_type: StageType | None
    #: The bracket round, or NULL for an encounter with no bracket position.
    round: int | None
    best_of: int
    status: EncounterStatus
    result_status: EncounterResultStatus
    scheduled_at: datetime | None
    participations: list[EncounterParticipationRef] = Field(default_factory=list)
    reports: list[TeamReportRead] = Field(default_factory=list)
    #: Every participation's replay codes, in play order -- what an adjudicator
    #: compares the reports against.
    replay_codes: list[ReplayCodeRead] = Field(default_factory=list)
    reported_count: int
    #: None until every participation has reported — "they disagree" and "only
    #: some have answered" are different states and the UI must not conflate them.
    standings_match: bool | None
    #: False when the reported standing is impossible for this encounter's rule.
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
