"""Batch owner-provider handle resolution for team materialization; legacy BattleTag imports retain their name pass."""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared.core.errors import ApiExc, ApiHTTPException
from shared.core.social import get_provider, normalize_social_handle
from shared.models.identity.social import SocialAccount
from shared.models.identity.user import User

__all__ = ("find_users_by_handles",)


def _name_part() -> sa.ColumnElement[str]:
    """Lowercased in-game name (before ``#``) of a BattleTag-shaped social account."""
    return sa.func.lower(sa.func.split_part(SocialAccount.username, "#", 1))


async def find_users_by_handles(session: AsyncSession, handles: list[str], *, provider: str | None) -> dict[str, User]:
    """Resolve owner-provider handles in a batch.

    Non-BattleTag providers require exact normalized accounts, never display names or prefixes.
    Legacy BattleTag imports retain their historical name/initcap + bare-name passes; that
    portable-import heuristic is not used by native roster admission.
    """
    tags = {tag for tag in handles if tag}
    if not tags:
        return {}
    tag_list = list(tags)
    resolved: dict[str, User] = {}
    spec = get_provider(provider) if provider is not None else None
    if spec is None or spec.normalize != "battletag":
        if provider is None:
            return {}
        normalized = {normalize_social_handle(provider, tag) for tag in tags}
        rows = await session.execute(
            sa.select(User, SocialAccount.username_normalized)
            .join(SocialAccount, SocialAccount.user_id == User.id)
            .where(SocialAccount.provider == provider, SocialAccount.username_normalized.in_(normalized))
        )
        by_normalized: dict[str, User] = {}
        for user, key in rows.unique().all():
            previous = by_normalized.get(key)
            if previous is not None and previous.id != user.id:
                raise ApiHTTPException(409, [ApiExc(code="identity_conflict", msg="Several players carry this handle")])
            by_normalized[key] = user
        return {
            tag: by_normalized[key] for tag in tags if (key := normalize_social_handle(provider, tag)) in by_normalized
        }

    # Pass 1: direct in-game name / initcap(name). Select the DB-computed
    # ``initcap`` value so we can map each matched row back to its tag exactly.
    name_query = sa.select(
        User,
        User.name.label("raw_name"),
        sa.func.initcap(User.name).label("initcap_name"),
    ).where(
        sa.or_(
            User.name.in_(tag_list),
            sa.func.initcap(User.name).in_(tag_list),
        )
    )
    for user, raw_name, initcap_name in (await session.execute(name_query)).unique().all():
        for candidate in (raw_name, initcap_name):
            if candidate in tags:
                resolved.setdefault(candidate, user)

    # Pass 2: the provider's social account (normalized handle, or in-game name part for BattleTags),
    # only for tags not already resolved by name.
    remaining = [tag for tag in tag_list if tag not in resolved]
    if remaining and provider is not None:
        spec = get_provider(provider)
        bare_name = spec is not None and spec.normalize == "battletag"
        norm_to_tag = {normalize_social_handle(provider, tag): tag for tag in remaining}
        lower_to_tag = {tag.lower(): tag for tag in remaining} if bare_name else {}
        matches = [SocialAccount.username_normalized.in_(list(norm_to_tag.keys()))]
        if bare_name:
            matches.append(_name_part().in_(list(lower_to_tag.keys())))
        handle_query = (
            sa.select(User, SocialAccount.username_normalized, _name_part().label("name_part"))
            .join(SocialAccount, User.id == SocialAccount.user_id)
            .where(SocialAccount.provider == provider, sa.or_(*matches))
        )
        for user, username_normalized, name_part in (await session.execute(handle_query)).unique().all():
            tag = norm_to_tag.get(username_normalized) or lower_to_tag.get(name_part)
            if tag is not None:
                resolved.setdefault(tag, user)

    return resolved
