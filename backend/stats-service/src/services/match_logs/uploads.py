"""Persist actual upload bytes before creating their workspace-owned native job."""

import asyncio

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from shared.clients.s3 import S3Client
from shared.core.errors import BaseAPIException as HTTPException
from shared.messaging.config import ACHIEVEMENT_EVALUATE_QUEUE
from shared.messaging.outbox import enqueue_outbox_event
from shared.repository.stats import IngestJobRepository
from shared.repository.tournament import TournamentRepository
from shared.schemas.events import AchievementEvaluateEvent
from src import models
from src.core.config import settings
from src.services.ingest.jobs import provenance_classifier
from src.services.match_logs.admin_reads import _validate_attached_encounter
from src.services.match_logs.limits import MATCH_NOT_FINISHED_MESSAGE, match_log_finished, match_log_oversize_message
from src.services.match_logs.log_records import compute_content_hash
from src.services.match_logs.realtime import emit_logs_updated


class UploadService:
    def __init__(self, *, repo: IngestJobRepository = IngestJobRepository()) -> None:
        self._repo = repo

    @staticmethod
    def validate_log_filename(filename: str | None) -> str:
        if not filename:
            raise HTTPException(status_code=400, detail="No file name provided")
        if len(filename) > 500 or ".." in filename or "/" in filename or "\\" in filename or "\x00" in filename:
            raise HTTPException(status_code=400, detail=f"Invalid file name: {filename}")
        return filename

    @staticmethod
    def decode_log_bytes(raw_bytes: bytes, filename: str | None) -> bytes:
        try:
            raw_bytes.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise HTTPException(status_code=400, detail=f"File {filename or '<unnamed>'} is not valid UTF-8") from exc
        return raw_bytes

    async def resolve_auth_uploader_id(self, session: AsyncSession, auth_user: models.AuthUser | None) -> int | None:
        if auth_user is None:
            return None
        return await session.scalar(select(models.User.id).where(models.User.auth_user_id == auth_user.id))

    async def store_uploaded_log_bytes(
        self,
        session: AsyncSession,
        *,
        s3: S3Client,
        tournament_id: int,
        filename: str | None,
        content: bytes,
        source: str,
        uploader_id: int | None = None,
        attached_encounter_id: int | None = None,
    ) -> models.IngestJob:
        filename = self.validate_log_filename(filename)
        oversize = match_log_oversize_message(len(content), settings.max_match_log_bytes, filename=filename)
        if oversize:
            raise HTTPException(status_code=413, detail=oversize)
        content = self.decode_log_bytes(content, filename)
        if not match_log_finished(content):
            raise HTTPException(status_code=400, detail=MATCH_NOT_FINISHED_MESSAGE)
        tournament = await TournamentRepository().get(session, tournament_id)
        if tournament is None:
            raise HTTPException(status_code=404, detail="Tournament not found")
        await _validate_attached_encounter(session, tournament_id=tournament_id, encounter_id=attached_encounter_id)
        content_hash = await asyncio.to_thread(compute_content_hash, content)
        raw_ref = f"logs/{tournament_id}/{content_hash}"
        # Retention uses the same object lock, so it cannot delete bytes between
        # this successful PUT and the job insert that makes them reachable.
        await session.execute(text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": f"stats.raw:{raw_ref}"})
        try:
            if not await s3.put_object(raw_ref, content):
                raise HTTPException(status_code=400, detail=f"Failed to upload file {filename}")
            job, _created = await self._repo.create_or_get(
                session,
                workspace_id=tournament.workspace_id,
                discipline=tournament.discipline,
                source_kind=source,
                external_id=None,
                content_hash=content_hash,
                filename=filename,
                raw_ref=raw_ref,
                document_ref=None,
                uploader_user_id=uploader_id,
                api_key_id=None,
                hint_tournament_id=tournament_id,
                hint_encounter_id=attached_encounter_id,
                hint_encounter_game_id=None,
                classify_existing=provenance_classifier(s3),
            )
            if _created:
                await emit_logs_updated(session, job.workspace_id, change="pending")
                await enqueue_outbox_event(
                    session,
                    AchievementEvaluateEvent(
                        workspace_id=job.workspace_id,
                        tournament_id=job.hint_tournament_id,
                        changed_tables=["stats.ingest_job"],
                        source_service="stats-service",
                    ),
                    exchange="",
                    routing_key=ACHIEVEMENT_EVALUATE_QUEUE.name,
                )
            await session.commit()
            return job
        except Exception:
            await session.rollback()
            raise


upload_service = UploadService()
validate_log_filename = upload_service.validate_log_filename
decode_log_bytes = upload_service.decode_log_bytes
resolve_auth_uploader_id = upload_service.resolve_auth_uploader_id
store_uploaded_log_bytes = upload_service.store_uploaded_log_bytes
