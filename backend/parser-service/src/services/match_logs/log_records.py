"""Service helpers for creating and updating LogProcessingRecord entries."""

from datetime import datetime, timezone

from loguru import logger
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models.log_processing import LogProcessingRecord, LogProcessingSource, LogProcessingStatus


async def _notify_result(session: AsyncSession, record: LogProcessingRecord, status: str) -> None:
    """Send pg_notify so discord-service can resolve waiting futures immediately."""
    payload = f"{record.tournament_id}|{record.filename}|{status}"
    try:
        await session.execute(text("SELECT pg_notify('log_processed', :p)"), {"p": payload})
    except Exception as exc:
        logger.warning(f"Failed to send pg_notify for log result: {exc}")


async def upsert_log_record(
    session: AsyncSession,
    tournament_id: int,
    filename: str,
    source: LogProcessingSource,
    uploader_id: int | None = None,
) -> LogProcessingRecord:
    """Create or refresh a log processing record. If a pending/failed record
    already exists for the same (tournament_id, filename), reuse it. Otherwise
    create a new one."""
    result = await session.execute(
        select(LogProcessingRecord)
        .where(
            LogProcessingRecord.tournament_id == tournament_id,
            LogProcessingRecord.filename == filename,
            LogProcessingRecord.status.in_([LogProcessingStatus.pending, LogProcessingStatus.failed]),
        )
        .limit(1)
    )
    record = result.scalar_one_or_none()

    if record is None:
        record = LogProcessingRecord(
            tournament_id=tournament_id,
            filename=filename,
            source=source,
            status=LogProcessingStatus.pending,
            uploader_id=uploader_id,
        )
        session.add(record)
    else:
        record.source = source
        record.status = LogProcessingStatus.pending
        record.error_message = None
        record.started_at = None
        record.finished_at = None
        if uploader_id is not None:
            record.uploader_id = uploader_id

    await session.commit()
    await session.refresh(record)
    return record


async def set_processing(session: AsyncSession, tournament_id: int, filename: str) -> LogProcessingRecord | None:
    """Mark the most recent pending record as 'processing'."""
    result = await session.execute(
        select(LogProcessingRecord)
        .where(
            LogProcessingRecord.tournament_id == tournament_id,
            LogProcessingRecord.filename == filename,
        )
        .order_by(LogProcessingRecord.created_at.desc())
        .limit(1)
    )
    record = result.scalar_one_or_none()

    if record is None:
        # No record created by upload — create one now for consumer-initiated processing
        record = LogProcessingRecord(
            tournament_id=tournament_id,
            filename=filename,
            source=LogProcessingSource.manual,
            status=LogProcessingStatus.processing,
            started_at=datetime.now(timezone.utc),
        )
        session.add(record)
    else:
        record.status = LogProcessingStatus.processing
        record.started_at = datetime.now(timezone.utc)
        record.error_message = None
        record.finished_at = None

    try:
        await session.commit()
    except Exception as exc:
        logger.warning(f"Failed to update log record to processing state: {exc}")
        await session.rollback()
        return None

    await session.refresh(record)
    return record


async def set_done(session: AsyncSession, record: LogProcessingRecord) -> None:
    """Mark a log processing record as done."""
    record.status = LogProcessingStatus.done
    record.finished_at = datetime.now(timezone.utc)
    try:
        await _notify_result(session, record, "done")
        await session.commit()
    except Exception as exc:
        logger.warning(f"Failed to mark log record as done: {exc}")
        await session.rollback()


async def set_failed(session: AsyncSession, record: LogProcessingRecord, error: str) -> None:
    """Mark a log processing record as failed."""
    record.status = LogProcessingStatus.failed
    record.finished_at = datetime.now(timezone.utc)
    record.error_message = error[:2000]  # guard against huge tracebacks
    try:
        await _notify_result(session, record, "failed")
        await session.commit()
    except Exception as exc:
        logger.warning(f"Failed to mark log record as failed: {exc}")
        await session.rollback()
