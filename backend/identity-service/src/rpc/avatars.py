"""Current-user avatar upload/removal (base64 over RPC)."""

from __future__ import annotations

from typing import Any

from faststream.rabbit.annotations import RabbitMessage
from sqlalchemy.ext.asyncio import AsyncSession

from src import schemas
from src.core.s3 import s3_client
from src.services.avatars import avatars

from . import _common as c

__all__ = ("register",)


def register(broker: Any, logger: Any) -> None:
    @broker.subscriber("rpc.identity.me.avatar_set")
    async def _me_avatar_set(data: dict, msg: RabbitMessage) -> dict:
        data = data or {}

        async def op(session: AsyncSession, user: Any) -> dict:
            updated = await avatars.set(session, user, s3_client, data.get("content_b64"), data.get("content_type"))
            return schemas.AuthUser.model_validate(updated, from_attributes=True).model_dump(mode="json")

        return await c.with_active_user(logger, data.get("access_token"), op)

    @broker.subscriber("rpc.identity.me.avatar_delete")
    async def _me_avatar_delete(data: dict, msg: RabbitMessage) -> dict:
        data = data or {}

        async def op(session: AsyncSession, user: Any) -> dict:
            updated = await avatars.delete(session, user, s3_client)
            return schemas.AuthUser.model_validate(updated, from_attributes=True).model_dump(mode="json")

        return await c.with_active_user(logger, data.get("access_token"), op)
