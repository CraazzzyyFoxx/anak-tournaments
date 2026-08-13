"""The single S3 client shared by every tournament-service RPC subscriber.

Replaces the route-time ``Depends(get_s3)`` (``request.app.state.s3``): the
worker has no FastAPI app state, so the client is constructed once from the
shared S3 settings and started lazily. ``start()`` only allocates an
aiobotocore session (no network I/O), so the first request that needs S3 can
start it without a serve.py startup hook.

Module-level on purpose — one client per process. Import ``get_s3`` here rather
than building a second ``S3Client`` in a new subscriber module.
"""

from __future__ import annotations

from shared.clients.s3 import S3Client
from src.core import config

_s3_client: S3Client | None = None
_s3_started = False


async def get_s3() -> S3Client:
    global _s3_client, _s3_started
    if _s3_client is None:
        _s3_client = S3Client(
            access_key=config.settings.s3_access_key,
            secret_key=config.settings.s3_secret_key,
            endpoint_url=config.settings.s3_endpoint_url,
            bucket_name=config.settings.s3_bucket_name,
            public_url=config.settings.s3_public_url,
        )
    if not _s3_started:
        await _s3_client.start()
        _s3_started = True
    return _s3_client
