from datetime import datetime
from typing import Literal

from pydantic import BaseModel

__all__ = ("CatalogSyncError", "CatalogSyncStage", "CatalogSyncState")


class CatalogSyncStage(BaseModel):
    #: ``source``, then the discipline's kinds in sync order (``mode``, ``map``, ``character``).
    key: str
    state: Literal["pending", "running", "done", "failed"]
    #: Images mirrored so far, of ``total``: only those not already on our bucket. ``None`` before the kind resolves
    #: its images and always on ``source``.
    done: int | None
    total: int | None
    #: Rows the kind created, set when it committed.
    created: int | None


class CatalogSyncError(BaseModel):
    #: ``catalog_source_unavailable``, the code of the refusal the module raised (``catalog_conflict``),
    #: ``interrupted`` (the worker shut down) or ``internal_error``.
    code: str
    msg: str


class CatalogSyncState(BaseModel):
    """One discipline's catalog sync: the snapshot ``GET`` reads and every ``catalog_sync.progress`` event carries."""

    discipline: str
    status: Literal["running", "done", "failed"]
    #: The module's source ("OverFast"); ``None`` until the sync reports it.
    source: str | None
    started_by: int
    started_at: datetime
    updated_at: datetime
    error: CatalogSyncError | None
    stages: list[CatalogSyncStage]
