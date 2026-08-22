"""Personal API keys of the calling user.

Transport only: parse the RPC payload, resolve the caller when the method needs
one, hand off to a service object, serialise the result. Every authorization
decision, query and error message belongs to ``src/services/**``.
"""

from __future__ import annotations

from typing import Any

from faststream.rabbit.annotations import RabbitMessage
from sqlalchemy.ext.asyncio import AsyncSession

from shared.rpc.query import build_query_model
from src import schemas
from src.services.api_keys import api_keys

from . import _common as c

__all__ = ("register",)


def register(broker: Any, logger: Any) -> None:
    @broker.subscriber("rpc.identity.list_api_keys")
    async def _list_api_keys(data: dict, msg: RabbitMessage) -> dict:
        data = data or {}

        async def op(session: AsyncSession, user: Any) -> dict:
            qp = build_query_model(schemas.ApiKeyListQueryParams, data.get("query"))
            params = schemas.ApiKeyListParams.from_query_params(qp)
            return c.paginated_dump(await api_keys.list(session, user=user, params=params))

        return await c.with_active_user(logger, data.get("access_token"), op)

    @broker.subscriber("rpc.identity.create_api_key")
    async def _create_api_key(data: dict, msg: RabbitMessage) -> dict:
        data = data or {}

        async def op(session: AsyncSession, user: Any) -> dict:
            payload = schemas.ApiKeyCreate.model_validate(data)
            result = await api_keys.create(
                session,
                user=user,
                payload=payload,
                ip_address=data.get("ip_address"),
                user_agent=data.get("user_agent"),
            )
            return result.model_dump(mode="json")

        return await c.with_active_user(logger, data.get("access_token"), op)

    @broker.subscriber("rpc.identity.update_api_key")
    async def _update_api_key(data: dict, msg: RabbitMessage) -> dict:
        data = data or {}

        async def op(session: AsyncSession, user: Any) -> dict:
            payload = schemas.ApiKeyUpdate.model_validate(data)
            result = await api_keys.update(
                session,
                user=user,
                api_key_id=c.require_int(data, "api_key_id"),
                payload=payload,
                ip_address=data.get("ip_address"),
                user_agent=data.get("user_agent"),
            )
            return result.model_dump(mode="json")

        return await c.with_active_user(logger, data.get("access_token"), op)

    @broker.subscriber("rpc.identity.revoke_api_key")
    async def _revoke_api_key(data: dict, msg: RabbitMessage) -> dict:
        data = data or {}

        async def op(session: AsyncSession, user: Any) -> None:
            await api_keys.revoke(
                session,
                user=user,
                api_key_id=c.require_int(data, "api_key_id"),
                ip_address=data.get("ip_address"),
                user_agent=data.get("user_agent"),
            )

        return await c.with_active_user(logger, data.get("access_token"), op)
