"""Current-user avatar upload / removal.

The gateway base64-encodes the multipart upload into the RPC body; it is
decoded here.
"""

from __future__ import annotations

import base64

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from shared.clients.s3 import S3Client
from shared.clients.s3.upload import upload_avatar
from shared.core.errors import BaseAPIException as HTTPException
from shared.repository import UserRepository
from src import models

__all__ = ("AvatarService", "avatars")


def _require_avatar_change_allowed(user: models.AuthUser) -> None:
    if user.is_denied("account", "avatar"):
        raise HTTPException(status_code=403, detail="You are not allowed to change your avatar")


class AvatarService:
    def __init__(self, *, players: UserRepository = UserRepository()) -> None:
        self.players = players

    async def set(
        self,
        session: AsyncSession,
        current_user: models.AuthUser,
        s3: S3Client,
        content_b64: object,
        content_type: object,
    ) -> models.AuthUser:
        """Upload or replace the current user's avatar image from base64 ``content_b64``."""
        _require_avatar_change_allowed(current_user)
        if not isinstance(content_b64, str) or not content_b64:
            raise HTTPException(status_code=422, detail="content_b64 is required")
        try:
            file_data = base64.b64decode(content_b64)
        except (ValueError, TypeError) as exc:
            raise HTTPException(status_code=400, detail="invalid base64 content") from exc

        result = await upload_avatar(
            s3,
            entity_type="users",
            entity_id=current_user.id,
            file_data=file_data,
            content_type=content_type if isinstance(content_type, str) and content_type else "application/octet-stream",
        )
        if not result.success:
            raise HTTPException(status_code=400, detail=result.error)

        current_user.avatar_url = result.public_url
        # Mirrored onto the linked player because ``users/[slug]`` renders the
        # player row, not the auth user.
        await self.players.set_avatar(session, auth_user_id=current_user.id, avatar_url=result.public_url)
        await session.commit()
        await session.refresh(current_user)

        logger.bind(user_id=str(current_user.id)).info("Avatar updated")
        return current_user

    async def delete(
        self,
        session: AsyncSession,
        current_user: models.AuthUser,
        s3: S3Client,
    ) -> models.AuthUser:
        """Delete the current user's avatar."""
        _require_avatar_change_allowed(current_user)
        await s3.delete_prefix(f"avatars/users/{current_user.id}/")
        current_user.avatar_url = None
        await self.players.set_avatar(session, auth_user_id=current_user.id, avatar_url=None)
        await session.commit()
        await session.refresh(current_user)

        logger.bind(user_id=str(current_user.id)).info("Avatar deleted")
        return current_user


avatars = AvatarService()
