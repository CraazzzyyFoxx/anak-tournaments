"""Typed-RPC handlers for canonical match ingestion (``POST /api/v1/stats/matches`` and its job read).

The gateway relays the original request bytes untouched as ``raw_base64`` next to the trusted ``identity`` it resolved;
nothing in the body can overwrite the identity, and workspace/key come only from the rehydrated credential.
"""

from __future__ import annotations

import base64
import binascii
from typing import Any

from faststream.rabbit import RabbitMessage

from shared.schemas.match_doc import MAX_MATCH_DOC_BYTES
from src.core import clients as _clients
from src.core import db
from src.services.ingest import jobs

from . import _common as c

_SF = db.async_session_maker
# Reject oversized base64 before allocating the decoded bytes.
_MAX_ENCODED = (MAX_MATCH_DOC_BYTES // 3 + 1) * 4


def _decode(data: dict[str, Any]) -> bytes:
    encoded = data.get("raw_base64")
    if not isinstance(encoded, str):
        raise jobs.IngestRejected(400, "invalid_request", "raw_base64 is required")
    if len(encoded) > _MAX_ENCODED:
        raise jobs.IngestRejected(413, "match_document_too_large", "Document exceeds the maximum size")
    try:
        return base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        raise jobs.IngestRejected(400, "invalid_request", "raw_base64 is not valid base64") from None


def register(broker: Any, logger: Any) -> None:
    @broker.subscriber("rpc.stats.ingest.submit")
    async def _submit(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.actor(data)
            c.require_active(user)
            jobs.require_ingest_principal(user)
            return await jobs.submit_document(session, raw=_decode(data), user=user, s3=_clients.s3_client)

        return await c.envelope(logger, "ingest.submit", op, session_factory=_SF)

    @broker.subscriber("rpc.stats.ingest.get")
    async def _get(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.actor(data)
            c.require_active(user)
            return await jobs.get_ingest_job(session, job_id=c.require_id(data), user=user)

        return await c.envelope(logger, "ingest.get", op, session_factory=_SF)
