"""Batch handle resolution under a tournament's identity provider, for team materialization."""

from __future__ import annotations

from collections.abc import Iterable

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared.core.errors import ApiExc, ApiHTTPException
from shared.core.social import get_provider, normalize_social_handle
from shared.domain.roster import PlayerRoster
from shared.models.identity.social import SocialAccount
from shared.models.identity.user import User

__all__ = ("find_users_by_handles", "refuse_missing_handles")


def refuse_missing_handles(rosters: Iterable[PlayerRoster]) -> None:
    """422 naming every registration without a game handle, before an export writes anything.

    Materialization finds players by handle: one without it would be skipped while the
    team named after them was still created, captainless and short.
    """
    names = list(
        dict.fromkeys(
            roster.display_name or f"registration #{roster.registration_id}" for roster in rosters if not roster.handle
        )
    )
    if names:
        raise ApiHTTPException(
            status_code=422,
            detail=[
                ApiExc(
                    code="missing_handle",
                    msg=f"These players have no game handle, so they cannot be exported: {', '.join(names)}. "
                    "Add the handle to their registration and export again.",
                )
            ],
        )


def _name_part() -> sa.ColumnElement[str]:
    """Lowercased in-game name (before ``#``) of a BattleTag-shaped social account."""
    return sa.func.lower(sa.func.split_part(SocialAccount.username, "#", 1))


async def find_users_by_handles(session: AsyncSession, handles: list[str], *, provider: str | None) -> dict[str, User]:
    """Resolve owner-provider handles in a batch.

    Non-BattleTag providers require exact normalized accounts, never display names or prefixes.
    BattleTag imports also match by user name (as-is or initcap) and by the bare in-game name;
    native roster admission does not use that heuristic.
    """
    tags = {tag for tag in handles if tag}
    if not tags or provider is None:
        return {}
    tag_list = list(tags)
    resolved: dict[str, User] = {}
    spec = get_provider(provider)
    if spec is None or spec.normalize != "battletag":
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

    # Pass 2: the BattleTag social account (normalized tag or in-game name part),
    # only for tags not already resolved by name.
    remaining = [tag for tag in tag_list if tag not in resolved]
    if remaining:
        norm_to_tag = {normalize_social_handle(provider, tag): tag for tag in remaining}
        lower_to_tag = {tag.lower(): tag for tag in remaining}
        handle_query = (
            sa.select(User, SocialAccount.username_normalized, _name_part().label("name_part"))
            .join(SocialAccount, User.id == SocialAccount.user_id)
            .where(
                SocialAccount.provider == provider,
                sa.or_(
                    SocialAccount.username_normalized.in_(list(norm_to_tag)),
                    _name_part().in_(list(lower_to_tag)),
                ),
            )
        )
        for user, username_normalized, name_part in (await session.execute(handle_query)).unique().all():
            tag = norm_to_tag.get(username_normalized) or lower_to_tag.get(name_part)
            if tag is not None:
                resolved.setdefault(tag, user)

    return resolved
