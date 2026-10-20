"""Process-wide S3 client for the avatar RPC handlers; serve.py's lifecycle hooks start and close it."""

from __future__ import annotations

from shared.clients import S3Client
from src.core.config import settings

s3_client = S3Client.from_settings(settings)
