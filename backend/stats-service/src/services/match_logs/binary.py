"""Raw access takes an already-authorized native job, never a client storage key."""

from shared.clients.s3 import S3Client
from shared.models import IngestJob


class BinaryMatchLogs:
    async def get_log(self, s3: S3Client, job: IngestJob) -> bytes | None:
        return await s3.get_object(job.raw_ref)

    async def delete_log(self, s3: S3Client, job: IngestJob) -> bool:
        return await s3.delete_object(job.raw_ref)


binary_match_logs = BinaryMatchLogs()
