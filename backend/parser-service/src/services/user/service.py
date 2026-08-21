import typing

import sqlalchemy as sa
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.strategy_options import _AbstractLoad

from shared.core.social import SocialProvider
from shared.services import social_identity
from shared.services.team_export.identity import (
    find_users_by_battle_tags as shared_find_users_by_battle_tags,
)
from src import models
from src.core import utils


def user_entities(in_entities: list[str], child: typing.Any | None = None) -> list[_AbstractLoad]:
    entities = []
    # Unified identity source consumed by ``to_pydantic``. Loaded whenever any
    # identity entity token is requested (legacy ``battle_tag``/``discord``/
    # ``twitch`` tokens are still accepted for caller/API compatibility).
    if any(name in in_entities for name in ("social_accounts", "battle_tag", "discord", "twitch")):
        entities.append(utils.join_entity(child, models.User.social_accounts))
    return entities


async def get(session: AsyncSession, user_id: int, entities: list[str]) -> models.User | None:
    query = sa.select(models.User).options(*user_entities(entities)).where(sa.and_(models.User.id == user_id))
    result = await session.execute(query)
    return result.unique().scalar_one_or_none()


async def find_users_by_battle_tags(session: AsyncSession, battle_tags: list[str]) -> dict[str, models.User]:
    """Batch equivalent of :func:`find_by_battle_tag` for a set of tags.

    Delegates to :func:`shared.services.team_export.identity.find_users_by_battle_tags`
    — this was a byte-identical copy of balancer-service's implementation, and
    both now share one. Kept as a wrapper so existing call sites are unchanged.
    """
    return await shared_find_users_by_battle_tags(session, battle_tags)


async def create_battle_tag(
    session: AsyncSession,
    player: models.User,
    *,
    battle_tag: str,
    name: str | None = None,
    tag: str | None = None,
) -> models.SocialAccount:
    """Attach a battlenet identity to ``player`` (idempotent). ``name``/``tag`` are
    accepted for caller compatibility but derived from ``battle_tag`` on read."""
    account = await social_identity.upsert_social_account(
        session, user_id=player.id, provider=SocialProvider.BATTLENET, username=battle_tag
    )
    await session.commit()
    logger.info(f"Battle Tag created [tag={battle_tag}] for player [id={player.id} name={player.name}]")
    return account
