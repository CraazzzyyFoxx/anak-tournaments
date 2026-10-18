"""Typed-RPC handlers for canonical match ingestion (``POST /api/v1/stats/matches`` and its job read).

The gateway relays the original request bytes untouched as ``raw_base64`` next to the trusted ``identity`` it resolved;
nothing in the body can overwrite the identity, and workspace/key come only from the rehydrated credential.
"""

from __future__ import annotations

import base64
import binascii
from typing import Any

from faststream.rabbit import RabbitMessage
from sqlalchemy import select

from shared.schemas.match_doc import MAX_MATCH_DOC_BYTES
from shared.services.audit import record_admin_audit
from src import models
from src.core import clients as _clients
from src.core import db
from src.schemas.ingest import BindIngestRequest
from src.services.ingest import jobs
from src.services.ingest.process import bind_ingest_job, game_observation

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

    @broker.subscriber("rpc.stats.ingest.bind")
    async def _bind(data: dict, msg: RabbitMessage) -> dict:
        # POST /admin/logs/{id}/bind -- admin ``log.update`` in the job's workspace (checked by the service).
        async def op(session: Any) -> Any:
            user = c.actor(data)
            c.require_active(user)
            job_id = c.require_id(data)
            try:
                request = BindIngestRequest.model_validate(c.payload(data))
            except ValueError as exc:
                raise jobs.IngestRejected(422, "invalid_request", "The bind request is invalid") from exc
            workspace_id = await session.scalar(
                select(models.IngestJob.workspace_id).where(models.IngestJob.id == job_id)
            )
            if workspace_id is not None and user.has_workspace_permission(workspace_id, "log", "update"):
                await record_admin_audit(
                    session,
                    action="match_log.bind",
                    actor=user,
                    data=data,
                    workspace_id=workspace_id,
                    entity_type="match_log",
                    entity_id=job_id,
                    after={
                        "encounter_game_id": request.encounter_game_id,
                        "expected_revision": request.expected_revision,
                    },
                )
            return await bind_ingest_job(session, job_id=job_id, request=request, user=user, s3=_clients.s3_client)

        return await c.envelope(logger, "ingest.bind", op, session_factory=_SF)

    @broker.subscriber("rpc.stats.ingest.game_observation")
    async def _game_observation(data: dict, msg: RabbitMessage) -> dict:
        # GET /admin/logs/games/{id}/observation -- workspace ``log.read`` of the game's workspace.
        async def op(session: Any) -> Any:
            user = c.actor(data)
            c.require_active(user)
            return await game_observation(session, encounter_game_id=c.require_id(data), user=user)

        return await c.envelope(logger, "ingest.game_observation", op, session_factory=_SF)
