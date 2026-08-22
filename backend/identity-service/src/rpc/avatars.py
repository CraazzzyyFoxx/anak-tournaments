"""Current-user avatar upload/removal (base64 over RPC).

Transport only: parse the RPC payload, resolve the caller when the method needs
one, hand off to a service object, serialise the result. Every authorization
decision, query and error message belongs to ``src/services/**``.
"""

from __future__ import annotations

import base64
from typing import Any

from faststream.rabbit.annotations import RabbitMessage
from sqlalchemy.ext.asyncio import AsyncSession

from shared.core.errors import BaseAPIException as HTTPException
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
            if user.is_denied("account", "avatar"):
                raise HTTPException(status_code=403, detail="You are not allowed to change your avatar")
            raw = data.get("content_b64")
            if not isinstance(raw, str) or not raw:
                raise HTTPException(status_code=422, detail="content_b64 is required")
            try:
                file_data = base64.b64decode(raw)
            except (ValueError, TypeError) as exc:
                raise HTTPException(status_code=400, detail="invalid base64 content") from exc
            content_type = data.get("content_type")
            updated = await avatars.set(
                session,
                user,
                s3_client,
                file_data,
                content_type if isinstance(content_type, str) else "application/octet-stream",
            )
            return schemas.AuthUser.model_validate(updated, from_attributes=True).model_dump(mode="json")

        return await c.with_active_user(logger, data.get("access_token"), op)

    @broker.subscriber("rpc.identity.me.avatar_delete")
    async def _me_avatar_delete(data: dict, msg: RabbitMessage) -> dict:
        data = data or {}

        async def op(session: AsyncSession, user: Any) -> dict:
            if user.is_denied("account", "avatar"):
                raise HTTPException(status_code=403, detail="You are not allowed to change your avatar")
            updated = await avatars.delete(session, user, s3_client)
            return schemas.AuthUser.model_validate(updated, from_attributes=True).model_dump(mode="json")

        return await c.with_active_user(logger, data.get("access_token"), op)
