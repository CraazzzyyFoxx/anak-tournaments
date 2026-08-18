import typing

import sqlalchemy as sa
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.strategy_options import _AbstractLoad

from shared.core.social import SocialProvider, normalize_social_handle
from shared.services import social_identity
from src import models
from src.core import utils


def _battlenet_name_part() -> sa.ColumnElement[str]:
    """Lowercased in-game name (before ``#``) of a battlenet social account."""
    return sa.func.lower(sa.func.split_part(models.SocialAccount.username, "#", 1))


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

    Resolves every tag in at most two queries (name pass, then battlenet social
    account pass) instead of the 2-4 SELECTs :func:`find_by_battle_tag` issues
    per name — this is what lets ``bulk_create_from_balancer`` avoid its N+1 fan
    of per-player lookups. Matching precedence mirrors ``find_by_battle_tag``:
    an in-game/``initcap`` name match wins over a social handle match. Relations
    are intentionally not eager-loaded (callers use only ``.id``/``.name``).
    """
    tags = {tag for tag in battle_tags if tag}
    if not tags:
        return {}
    tag_list = list(tags)
    resolved: dict[str, models.User] = {}

    # Pass 1: direct in-game name / initcap(name). Select the DB-computed
    # ``initcap`` value so we can map each matched row back to its tag exactly.
    name_query = sa.select(
        models.User,
        models.User.name.label("raw_name"),
        sa.func.initcap(models.User.name).label("initcap_name"),
    ).where(
        sa.or_(
            models.User.name.in_(tag_list),
            sa.func.initcap(models.User.name).in_(tag_list),
        )
    )
    for user, raw_name, initcap_name in (await session.execute(name_query)).unique().all():
        for candidate in (raw_name, initcap_name):
            if candidate in tags:
                resolved.setdefault(candidate, user)

    # Pass 2: battlenet social account (normalized handle or in-game name part),
    # only for tags not already resolved by name.
    remaining = [tag for tag in tag_list if tag not in resolved]
    if remaining:
        norm_to_tag = {normalize_social_handle(SocialProvider.BATTLENET, tag): tag for tag in remaining}
        lower_to_tag = {tag.lower(): tag for tag in remaining}
        battle_tag_query = (
            sa.select(
                models.User,
                models.SocialAccount.username_normalized,
                _battlenet_name_part().label("name_part"),
            )
            .join(models.SocialAccount, models.User.id == models.SocialAccount.user_id)
            .where(
                models.SocialAccount.provider == SocialProvider.BATTLENET,
                sa.or_(
                    models.SocialAccount.username_normalized.in_(list(norm_to_tag.keys())),
                    _battlenet_name_part().in_(list(lower_to_tag.keys())),
                ),
            )
        )
        for user, username_normalized, name_part in (await session.execute(battle_tag_query)).unique().all():
            tag = norm_to_tag.get(username_normalized) or lower_to_tag.get(name_part)
            if tag is not None:
                resolved.setdefault(tag, user)

    return resolved








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






