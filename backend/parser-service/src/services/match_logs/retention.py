"""Expire failed native jobs only when their raw bytes have no surviving owner.

Linked matches retain the job row itself, not an unusable orphaned S3 object.
Awaiting-link jobs are operator work and are never retention candidates.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import sqlalchemy as sa
from loguru import logger

from shared import models
from shared.observability import observe_scheduled_job
from shared.repository.catalog import CatalogAliasMissRepository
from shared.repository.stats import IngestJobRepository
from shared.services.distributed_lock import (
    DistributedLockUnavailable,
    acquire_distributed_lock,
    release_distributed_lock,
)
from shared.services.scheduler import IntervalScheduler
from shared.services.stats_evidence import capture_stats_evidence, owner_scopes, stage_stats_evidence
from src.core import db
from src.core.config import settings
from src.services.match_logs.binary import binary_match_logs

__all__ = ("purge_expired_failed_logs", "shutdown_scheduler", "start_scheduler")

LEADER_LOCK_KEY = "log_processing:retention:leader"
TICK_SECONDS = 3600
BATCH_SIZE = 100

_scheduler = IntervalScheduler(job_id="failed_match_log_retention", label="Failed match-log retention")
_repo = IngestJobRepository()
_alias_repo = CatalogAliasMissRepository()


async def purge_expired_failed_logs(
    *,
    redis: Any,
    s3: Any,
    session_factory: Any = db.async_session_maker,
    now: datetime | None = None,
) -> int:
    """Drop one batch of expired failed logs; return how many records went.

    Never raises — a failed tick is logged and the next one picks the rest up.
    """
    try:
        token = await acquire_distributed_lock(
            redis, LEADER_LOCK_KEY, ttl_seconds=TICK_SECONDS, acquire_timeout_seconds=0.5
        )
    except DistributedLockUnavailable:
        return 0

    cutoff = (now or datetime.now(UTC)) - timedelta(days=settings.failed_log_retention_days)
    async with observe_scheduled_job("failed_match_log_retention"):
        try:
            async with session_factory() as session:
                rows = await _repo.claim_expired_failed(session, cutoff=cutoff, limit=BATCH_SIZE)
                purged: list[int] = []
                for job in rows:
                    # Upload takes raw-key then job locks. Never wait here in
                    # the inverse order: a busy key is retried next tick.
                    locked = await session.scalar(
                        sa.text("SELECT pg_try_advisory_xact_lock(hashtext(:key))"), {"key": f"stats.raw:{job.raw_ref}"}
                    )
                    if not locked or await _repo.raw_ref_in_use(session, job.raw_ref, exclude_ids=[job.id]):
                        continue
                    try:
                        deleted = await binary_match_logs.delete_log(s3, job)
                    except Exception:
                        logger.exception("Raw delete failed for ingest job {}", job.id)
                        continue
                    if not deleted:
                        continue
                    scopes = owner_scopes("job", (job.id,))
                    before = await capture_stats_evidence(session, scopes=scopes)
                    alias = models.CatalogAliasMiss
                    while True:
                        ids = list(
                            await session.scalars(
                                sa.select(alias.id)
                                .where(
                                    alias.last_ingest_job_id == job.id,
                                )
                                .order_by(alias.id)
                                .limit(100)
                                .with_for_update()
                            )
                        )
                        if not ids:
                            break
                        alias_scopes = [scope for row_id in ids for scope in owner_scopes("alias", (row_id,))]
                        alias_before = await capture_stats_evidence(session, scopes=alias_scopes)
                        await _alias_repo.clear_ingest_job_references(session, ids)
                        alias_after = await capture_stats_evidence(session, scopes=alias_scopes)
                        await stage_stats_evidence(
                            session,
                            operation="stats.owner_delete",
                            before=alias_before,
                            after=alias_after,
                            workspace_id=job.workspace_id,
                            entity_type="ingest_job",
                            entity_id=job.id,
                        )
                    await _repo.delete_by_ids(session, [job.id])
                    after = await capture_stats_evidence(session, scopes=scopes)
                    await stage_stats_evidence(
                        session,
                        operation="stats.owner_delete",
                        before=before,
                        after=after,
                        workspace_id=job.workspace_id,
                        entity_type="ingest_job",
                        entity_id=job.id,
                    )
                    purged.append(job.id)
                await session.commit()
            if purged:
                logger.info("Failed match-log retention: purged={}", len(purged))
            return len(purged)
        except Exception:
            logger.exception("Failed match-log retention tick failed")
            return 0
        finally:
            await release_distributed_lock(redis, token)


def start_scheduler(*, redis: Any, s3: Any) -> None:
    _scheduler.start(purge_expired_failed_logs, seconds=TICK_SECONDS, kwargs={"redis": redis, "s3": s3})


def shutdown_scheduler() -> None:
    _scheduler.shutdown()
