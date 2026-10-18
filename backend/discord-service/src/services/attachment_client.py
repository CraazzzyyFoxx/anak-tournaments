"""The HTTP client that downloads a log attachment straight from Discord's CDN URL.

Log bytes then travel to stats-service over RabbitMQ (``UploadMatchLogEvent``); nothing here talks to another service.
"""

from __future__ import annotations

import httpx

from src.core.config import Settings


class AttachmentClientFactory:
    """Builds the ``httpx.AsyncClient`` for downloading attachments, through the configured egress proxy."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def create(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(proxy=self._settings.proxy_url, timeout=httpx.Timeout(30, read=60))
