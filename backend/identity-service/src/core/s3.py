"""Module-level S3 client for identity-svc (fastapi-free).

Relocated out of the (now removed) HTTP-over-RPC tunnel so the avatar typed-RPC
handlers can reuse a single client instance. Started/closed by the FastStream
worker lifecycle hooks in serve.py.
"""

from __future__ import annotations

from shared.clients import S3Client
from src.core.config import settings

s3_client = S3Client.from_settings(settings)
