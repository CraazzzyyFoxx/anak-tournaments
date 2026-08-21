"""S3-backed match-log binary storage.

Delegates to the shared ``S3Client`` (a process-global singleton with its own
start/stop lifecycle, per ``serve.py`` — never constructed here). ``s3`` stays
a method parameter rather than a constructor default, mirroring the
``session: AsyncSession`` convention: it's an externally-owned resource
threaded through every layer (``serve.py`` -> flows -> ``MatchLogProcessor``),
never stored on this singleton.
"""

from loguru import logger

from shared.clients.s3 import S3Client

__all__ = ("BinaryMatchLogs", "binary_match_logs")


class BinaryMatchLogs:
    """Key-naming + path-safety conventions for match-log blobs in S3."""

    async def get_logs_by_tournament(self, s3: S3Client, tournament_id: int) -> list[str]:
        return await s3.list_objects(f"logs/{tournament_id}/")

    async def get_log_by_filename(self, s3: S3Client, tournament_id: int, filename: str) -> bytes | None:
        base = f"logs/{tournament_id}/"
        bare = filename.removeprefix(base).removeprefix("logs/")
        if ".." in bare or bare.startswith("/"):
            logger.warning(f"Rejected suspicious filename: {filename!r}")
            return None
        key = f"{base}{bare}"
        return await s3.get_object(key)

    async def upload_log(self, s3: S3Client, tournament_id: int, filename: str, data: bytes) -> bool:
        key = f"logs/{tournament_id}/{filename}"
        folder_key = f"logs/{tournament_id}/"
        await s3.ensure_folder(folder_key)
        return await s3.put_object(key, data)

    async def delete_log(self, s3: S3Client, tournament_id: int, filename: str) -> bool:
        key = f"logs/{tournament_id}/{filename}"
        return await s3.delete_object(key)


binary_match_logs = BinaryMatchLogs()
