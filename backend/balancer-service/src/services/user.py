"""Simplified user service for balancer-service.

Provides the batch lookup ``team.py::bulk_create_from_balancer`` needs to
resolve balancer-exported roster members to existing users by battle tag.
"""

from __future__ import annotations

import logging

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared.core.social import SocialProvider, normalize_social_handle
from src import models

logger = logging.getLogger(__name__)


def _battlenet_name_part() -> sa.ColumnElement[str]:
    """Lowercased in-game name (before ``#``) of a battlenet social account."""
    return sa.func.lower(sa.func.split_part(models.SocialAccount.username, "#", 1))


async def find_users_by_battle_tags(session: AsyncSession, battle_tags: list[str]) -> dict[str, models.User]:
    """Resolve tags to existing users in at most two queries (name pass, then
    battlenet social account pass) instead of one lookup per tag — this is
    what lets ``bulk_create_from_balancer`` avoid its N+1 fan of per-player
    lookups (review H12). An in-game/``initcap`` name match wins over a social
    handle match. Relations are intentionally not eager-loaded (callers use
    only ``.id``).
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
        bt_query = (
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
        for user, username_normalized, name_part in (await session.execute(bt_query)).unique().all():
            tag = norm_to_tag.get(username_normalized) or lower_to_tag.get(name_part)
            if tag is not None:
                resolved.setdefault(tag, user)

    return resolved
