"""Process-global clients for the headless app-worker.

The HTTP service kept its S3 client on ``app.state.s3``; the typed-RPC handlers
have no request state, so the worker owns a module-level singleton instead.
``serve.py`` starts/stops it in the FastStream lifespan; binary handlers import
``s3_client`` directly.
"""

from __future__ import annotations

from shared.clients import S3Client
from src.core import config

s3_client = S3Client.from_settings(config.settings)
