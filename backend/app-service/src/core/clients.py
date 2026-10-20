"""Process-global clients for the headless app-worker.

Typed-RPC handlers have no request state, so the worker owns a module-level
singleton. ``serve.py`` starts/stops it in the FastStream lifespan; services
import ``s3_client`` directly. Lives in ``core`` rather than ``rpc`` because
``services/workspace/binary.py`` needs it, and a service reaching up into the
transport package would invert the layering.
"""

from __future__ import annotations

from shared.clients import S3Client
from src.core import config

s3_client = S3Client.from_settings(config.settings)
