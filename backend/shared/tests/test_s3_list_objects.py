"""Pin ``S3Client.list_objects`` error and marker semantics.

Both behaviours came out of one production failure: a 502 from the gateway in
front of MinIO during ``upload_log``, which called ``ensure_folder`` -> LIST ->
swallowed ``ClientError`` -> "folder missing" -> a zero-byte ``logs/90/``
marker PUT. The folder ops are gone (S3 has no directories), but the two
lessons need pinning: a failed LIST must not read as an empty prefix, and the
markers already sitting in the bucket must not be listed as objects -- the
tournament sweep in ``parser-service/serve.py`` fans every listed key out as a
log to parse.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from unittest import IsolatedAsyncioTestCase
from unittest.mock import MagicMock

from botocore.exceptions import ClientError

from shared.clients.s3 import S3Client


def _client(pages: list[dict] | Exception) -> S3Client:
    s3 = S3Client(access_key="k", secret_key="s", endpoint_url="http://minio", bucket_name="aqt")

    async def list_objects_v2(**_kwargs):
        if isinstance(pages, Exception):
            raise pages
        return pages.pop(0)

    fake = MagicMock(list_objects_v2=list_objects_v2)

    @asynccontextmanager
    async def _fake_client():
        yield fake

    s3._client = _fake_client  # type: ignore[method-assign]
    return s3


class TestListObjects(IsolatedAsyncioTestCase):
    async def test_paginates_and_drops_folder_markers(self):
        s3 = _client(
            [
                {
                    "Contents": [{"Key": "logs/90/"}, {"Key": "logs/90/a.txt"}],
                    "IsTruncated": True,
                    "NextContinuationToken": "t",
                },
                {"Contents": [{"Key": "logs/90/b.txt"}]},
            ]
        )
        self.assertEqual(["logs/90/a.txt", "logs/90/b.txt"], await s3.list_objects("logs/90/"))

    async def test_client_error_propagates(self):
        """An outage must not read as an empty prefix: ``delete_prefix`` would
        report 0 deletions and its callers would go on to null the owning DB
        column, and the log sweep would report a tournament with no logs."""
        error = ClientError({"Error": {"Code": "502", "Message": "Bad Gateway"}}, "ListObjectsV2")
        with self.assertRaises(ClientError):
            await _client(error).list_objects("logs/90/")
