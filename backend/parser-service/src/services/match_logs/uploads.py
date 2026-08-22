"""Shared service for storing uploaded match log files."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.clients.s3 import S3Client
from shared.core import http_status as status
from shared.core.errors import BaseAPIException as HTTPException
from shared.models.ingestion.log_processing import LogProcessingRecord, LogProcessingSource
from src import models
from src.services.match_logs.binary import binary_match_logs
from src.services.match_logs.log_records import LogRecordsService, log_records_service


class UploadService:
    """Stores uploaded match log files — S3 put + LogProcessingRecord upsert.

    Shared by the multipart upload route and the gateway base64 / bot-RabbitMQ
    ingest paths.
    """

    def __init__(self, *, log_records: LogRecordsService = log_records_service) -> None:
        self._log_records = log_records

    @staticmethod
    def validate_log_filename(filename: str | None) -> str:
        if not filename:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No file name provided")

        if ".." in filename or "/" in filename or "\\" in filename:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid file name: {filename}")

        return filename

    @staticmethod
    def decode_log_bytes(raw_bytes: bytes, filename: str | None) -> bytes:
        try:
            return raw_bytes.decode("utf-8").encode("utf-8")
        except UnicodeDecodeError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"File {filename or '<unnamed>'} is not valid UTF-8",
            ) from exc

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
        source: LogProcessingSource,
        uploader_id: int | None = None,
        attached_encounter_id: int | None = None,
    ) -> LogProcessingRecord:
        """Store an already-read log file (raw bytes) — shared by the multipart upload
        route and the gateway base64 / bot-RabbitMQ ingest paths."""
        filename = self.validate_log_filename(filename)
        decoded_bytes = self.decode_log_bytes(content, filename)

        uploaded = await binary_match_logs.upload_log(s3, tournament_id, filename, decoded_bytes)
        if not uploaded:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Failed to upload file {filename}")

        return await self._log_records.upsert_log_record(
            session,
            tournament_id=tournament_id,
            filename=filename,
            source=source,
            uploader_id=uploader_id,
            attached_encounter_id=attached_encounter_id,
        )


upload_service = UploadService()

validate_log_filename = upload_service.validate_log_filename
decode_log_bytes = upload_service.decode_log_bytes
resolve_auth_uploader_id = upload_service.resolve_auth_uploader_id
store_uploaded_log_bytes = upload_service.store_uploaded_log_bytes
