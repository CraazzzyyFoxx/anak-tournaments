"""Persist actual upload bytes before creating their workspace-owned native job."""

import asyncio
import base64
from typing import Any

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models, quota
from shared.clients.s3 import S3Client
from shared.core.errors import BaseAPIException as HTTPException
from shared.core.social import SocialProvider, normalize_social_handle
from shared.messaging.config import ACHIEVEMENT_EVALUATE_QUEUE
from shared.messaging.outbox import enqueue_outbox_event
from shared.repository.identity import UserRepository
from shared.repository.stats import IngestJobRepository
from shared.repository.tournament import TournamentRepository
from shared.schemas.events import AchievementEvaluateEvent
from shared.services.audit import record_admin_audit
from src import schemas
from src.core.config import settings
from src.services.ingest.jobs import lock_object, provenance_classifier
from src.services.match_logs.admin_reads import _validate_attached_encounter
from src.services.match_logs.limits import (
    MATCH_NOT_FINISHED_MESSAGE,
    match_log_finished,
    match_log_oversize_message,
    max_base64_length,
)
from src.services.match_logs.log_records import compute_content_hash, enqueue_ingest_request
from src.services.match_logs.realtime import emit_logs_updated


class UploadService:
    def __init__(
        self,
        *,
        repo: IngestJobRepository = IngestJobRepository(),
        users: UserRepository = UserRepository(),
        tournaments: TournamentRepository = TournamentRepository(),
    ) -> None:
        self._repo = repo
        self._users = users
        self._tournaments = tournaments

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
        return await self._users.get_id_by_auth_user_id(session, auth_user.id)

    async def resolve_discord_uploader_id(self, session: AsyncSession, discord_name: str) -> int | None:
        return await session.scalar(
            select(models.SocialAccount.user_id)
            .where(
                models.SocialAccount.provider == SocialProvider.DISCORD,
                models.SocialAccount.username_normalized
                == normalize_social_handle(SocialProvider.DISCORD, discord_name),
            )
            .limit(1)
        )

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
        correlation_id: str | None = None,
        channel_id: int | None = None,
        message_id: int | None = None,
    ) -> models.IngestJob:
        filename = self.validate_log_filename(filename)
        oversize = match_log_oversize_message(len(content), settings.max_match_log_bytes, filename=filename)
        if oversize:
            raise HTTPException(status_code=413, detail=oversize)
        content = self.decode_log_bytes(content, filename)
        if not match_log_finished(content):
            raise HTTPException(status_code=400, detail=MATCH_NOT_FINISHED_MESSAGE)
        tournament = await self._tournaments.get(session, tournament_id)
        if tournament is None:
            raise HTTPException(status_code=404, detail="Tournament not found")
        await _validate_attached_encounter(session, tournament_id=tournament_id, encounter_id=attached_encounter_id)
        content_hash = await asyncio.to_thread(compute_content_hash, content)
        raw_ref = f"logs/{tournament_id}/{content_hash}"
        await lock_object(session, raw_ref)
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
                        event_id=f"achievement:{job.workspace_id}:{job.hint_tournament_id or 0}:upload:{job.id}",
                        workspace_id=job.workspace_id,
                        tournament_id=job.hint_tournament_id,
                        changed_tables=["stats.ingest_job"],
                        source_service="stats-service",
                    ),
                    exchange="",
                    routing_key=ACHIEVEMENT_EVALUATE_QUEUE.name,
                )
            # A reused job is requested too: its uploader still gets the job's result (claim fencing makes the extra
            # delivery of a live job a no-op).
            await enqueue_ingest_request(
                session,
                job.id,
                discipline=job.discipline,
                correlation_id=correlation_id,
                channel_id=channel_id,
                message_id=message_id,
            )
            await session.commit()
            return job
        except Exception:
            await session.rollback()
            raise

    async def upload_batch(
        self,
        session: AsyncSession,
        s3: S3Client,
        *,
        user: models.AuthUser,
        data: dict[str, Any],
        tournament_id: int,
        encounter_id: int | None,
        files: list[dict[str, Any]],
    ) -> schemas.LogUploadResponse:
        """Store and queue each admin-uploaded file; a file's failure is collected, never fails the batch.

        Everything before the loop (names, tournament, attachment, quota) refuses the whole call.
        """
        if not files:
            raise HTTPException(status_code=400, detail="At least one log file is required")
        filenames = [self.validate_log_filename(f.get("filename")) for f in files]
        tournament = await self._tournaments.get(session, tournament_id)
        if tournament is None:
            raise HTTPException(status_code=404, detail="Tournament not found")
        attached_encounter = await _validate_attached_encounter(
            session, tournament_id=tournament.id, encounter_id=encounter_id
        )
        # Each file costs an S3 write plus its own parse job on the match-log
        # queue, so the call is priced by both byte volume and file count.
        await quota.charge(
            user,
            "stats.logs.upload",
            workspace_id=tournament.workspace_id,
            size_bytes=sum(len(f.get("content_b64") or "") for f in files),
            item_count=len(files),
        )
        uploader_id = await self.resolve_auth_uploader_id(session, user)

        uploaded: list[schemas.LogUploadItem] = []
        errors: list[schemas.LogUploadError] = []
        attached_encounter_id = attached_encounter.id if attached_encounter else None
        # One row for the call, staged before the first per-file commit inside
        # the loop. Names only — never the decoded bytes.
        await record_admin_audit(
            session,
            action="match_log.upload",
            actor=user,
            data=data,
            workspace_id=tournament.workspace_id,
            entity_type="tournament",
            entity_id=tournament.id,
            entity_label=tournament.name,
            after={"filenames": filenames},
        )

        max_log_bytes = settings.max_match_log_bytes
        for file_obj, filename in zip(files, filenames, strict=True):
            try:
                raw_b64 = file_obj.get("content_b64") or ""
                if len(raw_b64) > max_base64_length(max_log_bytes):
                    raise HTTPException(
                        status_code=413, detail=match_log_oversize_message(max_log_bytes + 1, max_log_bytes)
                    )
                content = base64.b64decode(raw_b64, validate=True)
                oversize = match_log_oversize_message(len(content), max_log_bytes)
                if oversize:
                    raise HTTPException(status_code=413, detail=oversize)
                if not match_log_finished(content):
                    raise HTTPException(status_code=400, detail=MATCH_NOT_FINISHED_MESSAGE)
                record = await self.store_uploaded_log_bytes(
                    session,
                    s3=s3,
                    tournament_id=tournament_id,
                    filename=filename,
                    content=content,
                    source="upload",
                    uploader_id=uploader_id,
                    attached_encounter_id=attached_encounter_id,
                )
                uploaded.append(
                    schemas.LogUploadItem(
                        record_id=record.id, filename=record.filename, attached_encounter_id=record.hint_encounter_id
                    )
                )
            except HTTPException as exc:
                await session.rollback()
                errors.append(schemas.LogUploadError(filename=filename, error=str(exc.detail)))
            except Exception as exc:  # noqa: BLE001 - collected per file
                await session.rollback()
                logger.exception("Failed to upload and queue admin log {}", filename)
                errors.append(schemas.LogUploadError(filename=filename, error=str(exc)))

        return schemas.LogUploadResponse(uploaded=uploaded, errors=errors)


upload_service = UploadService()
