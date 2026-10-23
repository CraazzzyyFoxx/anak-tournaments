"""Catalog sync as a background job: ``POST``/``GET /api/v1/admin/catalog-sync/{discipline}``.

``start`` takes the discipline's lock and runs its module's sync in a task of this process, so the request answers at
once. The snapshot (``CatalogSyncState``) lives in Redis under ``catalog_sync:{discipline}``: every stage change
rewrites it, refreshes the lock and publishes it whole as ``catalog_sync.progress`` on the starter's
``user:{id}:catalog-sync`` topic (non-durable: a client recovers through ``status``). While running, both keys live
``RUNNING_TTL`` past the last change, so a dead worker's sync expires; a finished snapshot stays ``FINISHED_TTL``.
One sync per discipline at a time; disciplines run in parallel.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any, Literal

import httpx
from loguru import logger

from shared.catalog_sync import CatalogImageMirror, CatalogSyncProgress
from shared.clients import CircuitBreakerOpen
from shared.core.errors import ApiExc, ApiHTTPException
from shared.disciplines import DISCIPLINES, DisciplineSpec
from shared.disciplines.spec import CatalogSync
from shared.schemas.realtime import WorkspaceEventEnvelope
from shared.services.realtime.scope import Scope
from shared.services.realtime_publisher import publish_envelope_to_redis
from src import schemas
from src.core.clients import realtime_redis, s3_client

__all__ = ("start", "status")

RUNNING_TTL = 300
FINISHED_TTL = 900
EVENT_TYPE = "catalog_sync.progress"

images = CatalogImageMirror(s3_client)
# asyncio keeps only a weak reference to a running task: a sync nobody holds could be collected mid-flight.
_tasks: set[asyncio.Task[None]] = set()


def _sync_of(code: str) -> tuple[DisciplineSpec, CatalogSync]:
    spec = DISCIPLINES.get(code)
    if spec is None or spec.catalog_sync is None:
        raise ApiHTTPException(404, [ApiExc(code="not_found", msg=f"Discipline {code!r} has no catalog sync")])
    return spec, spec.catalog_sync


def _key(code: str) -> str:
    return f"catalog_sync:{code}"


async def status(code: str) -> schemas.CatalogSyncState | None:
    """The last snapshot; ``None`` when nothing ran in the last 15 minutes or a running sync's worker died."""
    _sync_of(code)
    raw = await realtime_redis.get(_key(code))
    return None if raw is None else schemas.CatalogSyncState.model_validate_json(raw)


async def start(code: str, user_id: int, session_factory: Any) -> schemas.CatalogSyncState:
    """Start ``code``'s sync in the background; returns its first snapshot, 409 ``catalog_sync_running`` if one runs."""
    spec, sync = _sync_of(code)
    key, lock = _key(code), f"{_key(code)}:lock"
    if not await realtime_redis.set(lock, user_id, nx=True, ex=RUNNING_TTL):
        raise ApiHTTPException(
            409, [ApiExc(code="catalog_sync_running", msg=f"The {spec.name} catalog sync is already running")]
        )
    started_at = datetime.now(UTC)
    topic = Scope.user(user_id).domain_topic("catalog-sync")
    # One write at a time, so a slow write never lands after a newer snapshot.
    serial = asyncio.Lock()

    async def save(
        progress: CatalogSyncProgress,
        outcome: Literal["running", "done", "failed"] = "running",
        error: schemas.CatalogSyncError | None = None,
    ) -> schemas.CatalogSyncState:
        async with serial:
            state = schemas.CatalogSyncState(
                discipline=code,
                status=outcome,
                source=progress.source,
                started_by=user_id,
                started_at=started_at,
                updated_at=datetime.now(UTC),
                error=error,
                stages=list(progress.stages.values()),
            )
            # Progress is a courtesy: a Redis hiccup is logged and the sync goes on.
            try:
                running = outcome == "running"
                await realtime_redis.set(key, state.model_dump_json(), ex=RUNNING_TTL if running else FINISHED_TTL)
                await (realtime_redis.expire(lock, RUNNING_TTL) if running else realtime_redis.delete(lock))
                envelope = WorkspaceEventEnvelope(
                    event_id=0,
                    event_type=EVENT_TYPE,
                    occurred_at=state.updated_at,
                    actor_user_id=user_id,
                    data=state.model_dump(mode="json"),
                )
                await publish_envelope_to_redis(realtime_redis, topic=topic, envelope=envelope)
            except Exception:
                logger.exception("Catalog sync progress was not stored or published", discipline=code)
            return state

    async def run(progress: CatalogSyncProgress) -> None:
        try:
            # Its own session: the request's closes when ``start`` answers. The sync commits itself.
            async with session_factory() as session:
                await sync(session, images, progress)
        except asyncio.CancelledError:
            progress.fail()
            error = schemas.CatalogSyncError(code="interrupted", msg="The sync stopped with its worker; run it again")
            await save(progress, "failed", error)
            raise
        except Exception as exc:
            progress.fail()
            await save(progress, "failed", _error(spec, exc))
        else:
            await save(progress, "done")

    progress = CatalogSyncProgress(spec.kinds, save)
    state = await save(progress)
    # ponytail: an in-process task dies with this worker (a restart, a crash); the lock and the snapshot then expire
    # RUNNING_TTL after its last heartbeat and GET answers null. A durable queue job if syncs must survive restarts.
    task = asyncio.create_task(run(progress))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return state


def _error(spec: DisciplineSpec, exc: Exception) -> schemas.CatalogSyncError:
    if isinstance(exc, httpx.HTTPError | CircuitBreakerOpen):
        # The upstream's fault, not ours: the source timed out, is unreachable or answered an error.
        msg = f"The {spec.name} catalog source did not answer ({type(exc).__name__}); try again in a minute"
        return schemas.CatalogSyncError(code="catalog_source_unavailable", msg=msg)
    if isinstance(exc, ApiHTTPException):
        first = exc.detail[0]
        return schemas.CatalogSyncError(code=first["code"], msg=first["msg"])
    logger.exception("Catalog sync failed", discipline=spec.code)
    return schemas.CatalogSyncError(code="internal_error", msg=f"{type(exc).__name__}: {exc}"[:300])
