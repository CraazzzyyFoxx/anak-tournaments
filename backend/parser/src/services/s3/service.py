from contextlib import asynccontextmanager

from aiobotocore.session import get_session as get_async_session
from botocore.exceptions import ClientError
from loguru import logger

from src.core import config


class S3AsyncClient:
    def __init__(self, bucket_name: str):
        self.config = {
            "aws_access_key_id": config.settings.s3_access_key,
            "aws_secret_access_key": config.settings.s3_secret_key,
            "endpoint_url": config.settings.s3_endpoint_url,
        }
        self.bucket_name = bucket_name
        self.session = get_async_session()

    @asynccontextmanager
    async def get_client(self):
        async with self.session.create_client("s3", **self.config) as _client:
            yield _client

    async def _get_list_objects(self, prefix: str) -> list[str]:
        try:
            async with self.get_client() as _client:
                response = await _client.list_objects(Bucket=self.bucket_name, Prefix=prefix)
                if "Contents" not in response:
                    return []
                return [content["Key"] for content in response["Contents"]]
        except ClientError as e:
            logger.exception(f"Error listing objects: {e}")
            return []

    async def _get_object(self, key: str) -> str:
        try:
            async with self.get_client() as _client:
                response = await _client.get_object(Bucket=self.bucket_name, Key=key)
                return await response["Body"].read()
        except ClientError as e:
            if e.response["Error"]["Code"] == "404":
                logger.error(f"Object '{key}' does not exist in bucket '{self.bucket_name}'.")
                return ""
            logger.exception(f"Error getting object: {e}")
            return ""

    async def get_logs_by_tournament(self, tournament_id: int) -> list[str]:
        return await self._get_list_objects(f"logs/{tournament_id}/")

    async def get_log_by_filename(self, tournament_id: int, filename: str) -> str:
        if not filename.startswith("logs/"):
            filename = f"logs/{tournament_id}/{filename}"
        return await self._get_object(filename)

    async def upload_log(self, tournament_id: int, filename: str, data: bytes) -> bool:
        object_key = f"logs/{tournament_id}/{filename}"
        folder_key = f"logs/{tournament_id}/"

        try:
            async with self.get_client() as _client:
                try:
                    await _client.head_object(Bucket=self.bucket_name, Key=folder_key)
                except ClientError as e:
                    if e.response["Error"]["Code"] == "404":
                        await _client.put_object(Bucket=self.bucket_name, Key=folder_key)
                    else:
                        raise

                await _client.put_object(Bucket=self.bucket_name, Key=object_key, Body=data)

                logger.info(f"Uploaded file to {object_key}")
                return True
        except ClientError as e:
            logger.exception(f"Error uploading log: {e}")
            return False

    async def delete_log(self, tournament_id: int, filename: str) -> bool:
        object_key = f"logs/{tournament_id}/{filename}"
        try:
            async with self.get_client() as _client:
                await _client.delete_object(Bucket=self.bucket_name, Key=object_key)
                logger.info(f"Deleted log {object_key}")
                return True
        except ClientError as e:
            logger.exception(f"Error deleting log: {e}")
            return False

    async def get_tournament_teams(self, tournament_id: int) -> list[str]:
        return await self._get_list_objects(f"{tournament_id}/teams/")

    async def get_tournaments_teams(self) -> dict[str, str]:
        tournaments = await self._get_list_objects("teams/tournament")
        tournament_teams = {}
        for tournament in tournaments:
            tournament_id = tournament.split("/")[1]
            teams = await self._get_object(tournament)
            tournament_teams[tournament_id] = teams

        return tournament_teams




async_client = S3AsyncClient(bucket_name=config.settings.s3_bucket_name)
