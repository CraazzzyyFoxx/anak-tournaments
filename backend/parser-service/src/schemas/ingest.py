"""Public read model of a canonical ingest job. Never carries storage keys, credentials or the document."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from shared.models import IngestJobStatus

__all__ = (
    "BindIngestRequest",
    "GameObservationRead",
    "IngestBinding",
    "IngestError",
    "IngestIssueRead",
    "IngestJobRead",
    "IngestTeamKey",
)


class BindIngestRequest(BaseModel):
    """An operator's complete team map for one stored document: ``document team key -> encounter.team id``.

    The document itself is never part of the request: bind retries the job's stored canonical document or raw source.
    ``expected_revision`` is the operator's view of the target game: ``0`` = no observation yet, ``n`` = replace exactly
    revision ``n``. It is required when the target is occupied and compared again under the final lock.
    """

    model_config = ConfigDict(extra="forbid")

    encounter_game_id: Annotated[int, Field(strict=True, gt=0)]
    teams: Annotated[
        dict[Annotated[str, StringConstraints(min_length=1, max_length=64)], Annotated[int, Field(strict=True, gt=0)]],
        Field(min_length=1),
    ]
    expected_revision: Annotated[int, Field(strict=True, ge=0)] | None = None


class GameObservationRead(BaseModel):
    """The authoritative current observation of one game: what a bind's ``expected_revision`` must equal.

    Unoccupied: ``match_id``/``ingest_job_id`` null and ``revision`` 0. ``is_historical`` marks an observation that
    has no job or came from a historical import: it can never be replaced by a bind or reparse.
    """

    encounter_game_id: int
    match_id: int | None = None
    revision: int = 0
    ingest_job_id: int | None = None
    is_historical: bool = False


class IngestTeamKey(BaseModel):
    """A document team in canonical order, so an operator UI can build the bind team map for an awaiting job."""

    key: str
    source_position: int
    participants: list[str] = []


class IngestIssueRead(BaseModel):
    path: list[str | int]
    code: str
    message: str
    kind: str | None = None
    raw_name: str | None = None


class IngestError(BaseModel):
    code: str
    message: str
    issues: list[IngestIssueRead] = []


class IngestBinding(BaseModel):
    """The match this job is still the current evidence for; absent once superseded or while unbound."""

    encounter_game_id: int
    match_id: int
    revision: int


class IngestJobRead(BaseModel):
    id: int
    workspace_id: int
    discipline: str
    source_kind: str
    external_id: str | None
    content_hash: str | None
    status: IngestJobStatus
    attempts: int
    created_at: datetime
    updated_at: datetime | None
    started_at: datetime | None
    finished_at: datetime | None
    error: IngestError | None = None
    binding: IngestBinding | None = None
