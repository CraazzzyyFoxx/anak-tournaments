"""Who runs a mix: its host, a co-host or a superuser -- ``CustomGameService._writable``'s audience (spec §2)."""

from __future__ import annotations

from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models

__all__ = ("is_mix_host",)


async def is_mix_host(session: AsyncSession, auth_user: Any, custom_game_id: int) -> bool:
    """Host, co-host or superuser of the mix."""
    if auth_user.is_superuser:
        return True
    co_host = sa.exists().where(
        models.CustomGameCoHost.custom_game_id == custom_game_id, models.CustomGameCoHost.user_id == auth_user.id
    )
    return bool(
        await session.scalar(
            sa.select(sa.or_(models.CustomGame.host_user_id == auth_user.id, co_host)).where(
                models.CustomGame.id == custom_game_id
            )
        )
    )
