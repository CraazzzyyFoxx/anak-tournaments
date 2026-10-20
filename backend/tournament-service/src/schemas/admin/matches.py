"""Read models for the admin parsed-matches list and detail.

A parsed match is one played map, written by the log parser; these reads answer
whether a log produced the maps it should have.

``LogRecordRef`` is declared here rather than reused from stats-service's
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
from shared.models.stats.ingest import IngestJobStatus
from shared.schemas.catalog import CatalogEntityRead
from shared.schemas.discipline_filter import InstalledDisciplineFilter
from shared.schemas.match import MatchRead

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
    filename: str | None
    status: IngestJobStatus
    source: str | None
    uploader_id: int | None
    #: Times the record entered processing; >1 means the stall reaper requeued it.
    attempts: int | None
    error_message: str | None
    created_at: datetime | None
    started_at: datetime | None
    finished_at: datetime | None


class AdminMatchRow(MatchRead):
    """One observed map: the native match header (participants, official result lines, observed team facts) plus the
    admin context. Deleted source teams and absent raw provenance stay null."""

    #: Always expanded, with its mode as ``parent``.
    map: CatalogEntityRead
    encounter_name: str
    tournament_id: int
    tournament_name: str
    #: None means no raw log is available for this observation.
    log_record: LogRecordRef | None


class AdminMatchDetail(AdminMatchRow):
    """Detail-only player fact and event volumes; no team-score facts counted."""

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
    log_status: list[IngestJobStatus] = []
    unlinked_only: bool = False
    #: One installed game's observed maps; absent is every game of the workspace (spec §8.1).
    discipline: InstalledDisciplineFilter = None


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
    log_status: list[IngestJobStatus] = field(default_factory=list)
    unlinked_only: bool = False
    discipline: str | None = None
