"""Token issuance/validation for the gateway's own auth middleware.

Transport only: parse the RPC payload, resolve the caller when the method needs
one, hand off to a service object, serialise the result. Every authorization
decision, query and error message belongs to ``src/services/**``.
"""

from __future__ import annotations

from typing import Any

from faststream.rabbit.annotations import RabbitMessage
from sqlalchemy.ext.asyncio import AsyncSession

from src import schemas
from src.schemas.rpc import rpc_error
from src.services.service_tokens import service_tokens
from src.services.token_validation import token_validation

from . import _common as c

__all__ = ("register",)


def register(broker: Any, logger: Any) -> None:
    @broker.subscriber("rpc.identity.validate_token")
    async def _validate_token(data: dict, msg: RabbitMessage) -> dict:
        """Validate a bearer access token / API key, returning RBAC TokenPayload."""
        token = (data or {}).get("token")
        if not token or not isinstance(token, str):
            return rpc_error("bad_request", "token is required")

        async def run(session: AsyncSession) -> dict:
            payload = await token_validation.validate(session, token)
            return payload.model_dump(mode="json")

        return await c.envelope_session(logger, "validate_token", run)

    @broker.subscriber("rpc.identity.service_token")
    async def _service_token(data: dict, msg: RabbitMessage) -> dict:
        async def run() -> dict:
            req = schemas.ServiceTokenRequest.model_validate(data or {})
            return service_tokens.issue(req.client_id, req.client_secret).model_dump(mode="json")

        return await c.envelope(logger, "service_token", run)

    @broker.subscriber("rpc.identity.validate_service_token")
    async def _validate_service_token(data: dict, msg: RabbitMessage) -> dict:
        token = (data or {}).get("token")
        if not token or not isinstance(token, str):
            return rpc_error("unauthorized", "Invalid service token")

        async def run() -> dict:
            return service_tokens.validate(token).model_dump(mode="json")

        return await c.envelope(logger, "validate_service_token", run)

    @broker.subscriber("rpc.identity.invalidate_session")
    async def _invalidate_session(data: dict, msg: RabbitMessage) -> dict:
        data = data or {}
        token = data.get("token")
        if not token or not isinstance(token, str):
            return rpc_error("forbidden", "Not authenticated")
        try:
            user_id = int(data.get("user_id"))
        except (TypeError, ValueError):
            return rpc_error("bad_request", "Invalid user id")

        async def run() -> None:
            await service_tokens.invalidate_rbac(token, user_id)

        return await c.envelope(logger, "invalidate_session", run)
