"""Service for creating and updating LogProcessingRecord entries."""

import hashlib
from datetime import UTC, datetime

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models.ingestion.log_processing import LogProcessingRecord, LogProcessingSource, LogProcessingStatus
from shared.repository.support import LogProcessingRepository


class LogRecordsService:
    def __init__(self, *, repo: LogProcessingRepository = LogProcessingRepository()) -> None:
        self._repo = repo

    @staticmethod
    def compute_content_hash(raw_bytes: bytes) -> str:
        """Return hex SHA-256 of the raw log file bytes."""
        return hashlib.sha256(raw_bytes).hexdigest()

    async def is_already_processed(
        self,
        session: AsyncSession,
        tournament_id: int,
        filename: str,
        content_hash: str,
    ) -> bool:
        """Return True when a *done* record with the same content hash already exists.

        This lets us skip reprocessing an unchanged log file that was re-uploaded.
        """
        return await self._repo.exists(
            session,
            tournament_id=tournament_id,
            filename=filename,
            status=LogProcessingStatus.done,
            content_hash=content_hash,
        )

    async def upsert_log_record(
        self,
        session: AsyncSession,
        tournament_id: int,
        filename: str,
        source: LogProcessingSource,
        uploader_id: int | None = None,
        attached_encounter_id: int | None = None,
    ) -> LogProcessingRecord:
        """Create or refresh a log processing record. If a pending/failed record
        already exists for the same (tournament_id, filename), reuse it. Otherwise
        create a new one."""
        record = await self._repo.find_reusable(session, tournament_id=tournament_id, filename=filename)

        if record is None:
            record = LogProcessingRecord(
                tournament_id=tournament_id,
                filename=filename,
                source=source,
                status=LogProcessingStatus.pending,
                uploader_id=uploader_id,
                attached_encounter_id=attached_encounter_id,
            )
            await self._repo.create(session, record)
        else:
            record.source = source
            record.status = LogProcessingStatus.pending
            record.attached_encounter_id = attached_encounter_id
            record.error_message = None
            record.started_at = None
            record.finished_at = None
            # Fresh upload of this filename: content may differ from whatever
            # exhausted the previous retry budget, so the reaper starts over.
            record.attempts = 0
            if uploader_id is not None:
                record.uploader_id = uploader_id

        await session.commit()
        await session.refresh(record)
        return record

    async def set_processing(
        self,
        session: AsyncSession,
        tournament_id: int,
        filename: str,
        content_hash: str | None = None,
    ) -> LogProcessingRecord | None:
        """Mark the most recent pending record as 'processing'."""
        record = await self._repo.find_latest(session, tournament_id=tournament_id, filename=filename)

        if record is None:
            # No record created by upload — create one now for consumer-initiated processing
            record = LogProcessingRecord(
                tournament_id=tournament_id,
                filename=filename,
                source=LogProcessingSource.manual,
                status=LogProcessingStatus.processing,
                started_at=datetime.now(UTC),
                content_hash=content_hash,
                attempts=1,
            )
            await self._repo.create(session, record)
        else:
            record.status = LogProcessingStatus.processing
            record.started_at = datetime.now(UTC)
            record.error_message = None
            record.finished_at = None
            record.attempts = (record.attempts or 0) + 1
            if content_hash is not None:
                record.content_hash = content_hash

        try:
            await session.commit()
        except Exception as exc:
            logger.warning(f"Failed to update log record to processing state: {exc}")
            await session.rollback()
            return None

        await session.refresh(record)
        return record

    async def finish_duplicate_record(
        self,
        session: AsyncSession,
        tournament_id: int,
        filename: str,
        content_hash: str,
    ) -> LogProcessingRecord | None:
        """Mark the latest incomplete record as done when the uploaded content is a duplicate."""
        record = await self._repo.find_latest_incomplete(
            session,
            tournament_id=tournament_id,
            filename=filename,
            statuses=[LogProcessingStatus.pending, LogProcessingStatus.processing, LogProcessingStatus.failed],
        )
        if record is None:
            return None

        if record.started_at is None:
            record.started_at = datetime.now(UTC)
        record.error_message = None
        record.content_hash = content_hash
        await self.set_done(session, record)
        return record

    async def set_done(self, session: AsyncSession, record: LogProcessingRecord) -> None:
        """Mark a log processing record as done."""
        record.status = LogProcessingStatus.done
        record.finished_at = datetime.now(UTC)
        try:
            await session.commit()
        except Exception as exc:
            logger.warning(f"Failed to mark log record as done: {exc}")
            await session.rollback()

    async def set_failed(self, session: AsyncSession, record: LogProcessingRecord, error: str) -> None:
        """Mark a log processing record as failed."""
        record.status = LogProcessingStatus.failed
        record.finished_at = datetime.now(UTC)
        record.error_message = error[:2000]  # guard against huge tracebacks
        try:
            await session.commit()
        except Exception as exc:
            logger.warning(f"Failed to mark log record as failed: {exc}")
            await session.rollback()

    async def fail_unstarted(
        self,
        session: AsyncSession,
        tournament_id: int,
        filename: str,
        error: str,
    ) -> LogProcessingRecord | None:
        """Fail the latest unfinished record for a log that never reached processing.

        ``flows.process_match_log`` rejects a missing or oversized S3 object before
        ``set_processing`` runs, so the row kept its ``pending`` status — "Queued" in
        the admin console — and never spent a reaper attempt (``attempts`` is only
        bumped by ``set_processing``). The stall reaper then republished it every
        window forever, because its ``max_attempts`` guard could never trip. Marking
        the row ``failed`` is terminal: the reaper leaves ``failed`` alone and an
        operator sees the actual reason instead of an eternal queue.
        """
        record = await self._repo.find_latest_incomplete(
            session,
            tournament_id=tournament_id,
            filename=filename,
            statuses=[LogProcessingStatus.pending, LogProcessingStatus.processing],
        )
        if record is None:
            return None

        await self.set_failed(session, record, error)
        return record

    async def retry(self, session: AsyncSession, record_id: int) -> LogProcessingRecord | None:
        """Reset a record to a fresh retry budget for the admin "retry" action.

        An operator asking for a retry gets a fresh budget, so a record the
        stall reaper retired can be driven again.
        """
        record = await self._repo.get(session, record_id)
        if record is None:
            return None

        await self._repo.update_fields(
            session,
            record,
            {
                "status": LogProcessingStatus.pending,
                "error_message": None,
                "started_at": None,
                "finished_at": None,
                "attempts": 0,
            },
        )
        await session.commit()
        await session.refresh(record)
        return record


log_records_service = LogRecordsService()

compute_content_hash = log_records_service.compute_content_hash
is_already_processed = log_records_service.is_already_processed
upsert_log_record = log_records_service.upsert_log_record
set_processing = log_records_service.set_processing
finish_duplicate_record = log_records_service.finish_duplicate_record
set_done = log_records_service.set_done
set_failed = log_records_service.set_failed
fail_unstarted = log_records_service.fail_unstarted
