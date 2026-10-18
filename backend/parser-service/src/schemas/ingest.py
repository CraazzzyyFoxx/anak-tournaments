"""Public read model of a canonical ingest job. Never carries storage keys, credentials or the document."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

from shared.models import IngestJobStatus

__all__ = ("IngestBinding", "IngestError", "IngestIssueRead", "IngestJobRead")


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
