"""Read models for the admin parsed-matches list and detail.

A parsed match is one played map, written by the log parser. Until now the only
admin-visible signal that any of this existed was ``Encounter.has_logs: bool``,
so «did this log actually produce the maps it should have» had no answer short of
opening the public match page one encounter at a time.

``LogRecordRef`` is declared here rather than reused from parser-service's
``LogRecordRead``: that schema belongs to another service and carries the log
console's own fields (tournament/encounter names, uploader name). This one is the
provenance block of a match, and it is deliberately thin — the log console
remains the place to inspect ingestion itself.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from pydantic import BaseModel

from shared.core import pagination
from shared.models.ingestion.log_processing import LogProcessingSource, LogProcessingStatus

# The team ref is shared with the reports list rather than duplicated: both
# surfaces mean the same thing by "a team, reduced to what a table cell shows",
# and two identical models would drift.
from src.schemas.admin.encounter_reports import EncounterTeamRef

__all__ = (
    "AdminMatchDetail",
    "AdminMatchRow",
    "AdminMatchesQueryParams",
    "AdminMatchesSearchParams",
    "LogRecordRef",
)


class LogRecordRef(BaseModel):
    """The ingestion record a match was parsed from.

    Every field but the identity is nullable because a record is a *live*
    ingestion state, not a finished document: ``started_at`` is unset until the
    worker picks it up, ``finished_at`` until it stops, and ``error_message``
    only ever fills in on failure.
    """

    id: int
    filename: str
    status: LogProcessingStatus
    source: LogProcessingSource | None
    uploader_id: int | None
    #: Times the record entered processing; >1 means the stall reaper requeued it.
    attempts: int | None
    error_message: str | None
    created_at: datetime | None
    started_at: datetime | None
    finished_at: datetime | None


class AdminMatchRow(BaseModel):
    """One parsed match — a single played map — as the log parser produced it.

    Only ``log_record`` is optional. Everything else hangs off a NOT NULL foreign
    key, so a row that cannot name its encounter, tournament, map or either team
    is a broken invariant and should surface as one rather than as empty cells.
    """

    id: int
    encounter_id: int
    encounter_name: str
    tournament_id: int
    tournament_name: str
    map_id: int
    map_name: str
    home_team: EncounterTeamRef
    away_team: EncounterTeamRef
    home_score: int
    away_score: int
    #: Map duration in seconds.
    time: float
    #: The bare filename the parser recorded. Kept alongside ``log_record``
    #: because the S3 key is still built from it, so the log stays downloadable
    #: even when the owning record could not be resolved.
    log_name: str
    #: In-game match code. Searched by the free-text filter, so it is returned
    #: too — a column you can match on but never see makes a hit look arbitrary.
    code: str | None
    created_at: datetime
    #: None means the provenance is unresolved, which is the normal state for the
    #: bulk of the history: ``log_processing.record`` postdates most parsed
    #: matches and the backfill left those NULL instead of guessing (D22).
    log_record: LogRecordRef | None


class AdminMatchDetail(AdminMatchRow):
    """A single match with the per-match aggregates the list omits.

    NFR 3: ``matches.statistics`` / ``kill_feed`` / ``assists`` are the hot,
    high-volume tables. Counting them per row would put three aggregate scans
    behind every page of the list, so they live here — one row at a time.
    """

    #: Highest round the parser recorded; 0 when no statistics landed at all,
    #: which is itself the diagnostic (the log parsed but produced nothing).
    rounds: int
    statistics_count: int
    kill_feed_count: int
    event_count: int


class AdminMatchesQueryParams(pagination.PaginationSortSearchQueryParams):
    """Wire shape of the list's query string."""

    tournament_id: int | None = None
    encounter_id: int | None = None
    map_id: int | None = None
    log_status: list[LogProcessingStatus] = []
    unlinked_only: bool = False


@dataclass
class AdminMatchesSearchParams(pagination.PaginationSortSearchParams):
    """Parsed filters.

    The service splits these into "scope" (workspace, tournament, encounter, map,
    free text) and "provenance" (``log_status``, ``unlinked_only``). Scope decides
    which rows the caller may see at all; provenance only narrows inside it.
    """

    tournament_id: int | None = None
    encounter_id: int | None = None
    map_id: int | None = None
    log_status: list[LogProcessingStatus] = field(default_factory=list)
    unlinked_only: bool = False
