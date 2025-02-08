from contextlib import asynccontextmanager

from aiobotocore.session import get_session as get_async_session
from botocore.exceptions import ClientError
from loguru import logger

from src.core import config


class S3AsyncClient:
    def __init__(self, bucket_name: str):
        self.config = {
            "aws_access_key_id": config.app.s3_access_key,
            "aws_secret_access_key": config.app.s3_secret_key,
            "endpoint_url": config.app.s3_endpoint_url,
        }
        self.bucket_name = bucket_name
        self.session = get_async_session()

    @asynccontextmanager
    async def get_client(self):
        async with self.session.create_client("s3", **self.config) as _client:
            yield _client

    async def get_logs_by_tournament(self, tournament_id: int) -> list[str]:
        try:
            async with self.get_client() as _client:
                response = await _client.list_objects(
                    Bucket=self.bucket_name, Prefix=f"logs/{tournament_id}/"
                )
                if "Contents" not in response:
                    return []
                return [content["Key"] for content in response["Contents"]]
        except ClientError as e:
            logger.exception(f"Error getting logs: {e}")
            return []

    async def get_log_by_filename(self, tournament_id: int, filename: str) -> str:
        if not filename.startswith("logs/"):
            filename = f"logs/{tournament_id}/{filename}"
        try:
            async with self.get_client() as _client:
                # Check if the object exists using head_object
                try:
                    await _client.head_object(Bucket=self.bucket_name, Key=filename)
                except ClientError as e:
                    if (
                        e.response["Error"]["Code"] == "404"
                    ):  # Specific handling of NoSuchKey
                        logger.error(
                            f"File '{filename}' does not exist in bucket '{self.bucket_name}'."
                        )
                        return ""
                    else:
                        raise

                response = await _client.get_object(
                    Bucket=self.bucket_name, Key=filename
                )
                return await response["Body"].read()
        except ClientError as e:
            # Catch-all for other ClientErrors
            logger.exception(f"Error getting log by filename: {e}")
            return ""


async_client = S3AsyncClient(bucket_name=config.app.s3_bucket)
