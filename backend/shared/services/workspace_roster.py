"""The roster a workspace balances from: its members, by BattleTag.

``workspace_member`` is the anchor registrations, teams, drafts and achievements
already use, so it is also the roster the mix tools read -- there is no separate
balancer-local player list to keep in sync with it. Adding somebody by BattleTag
therefore provisions the same identity a registration would: find-or-create the
``players.user``, attach the battlenet handle, anchor the membership.

This is the reusable half of ``registration_service.ensure_player_identity``.
The registration-specific precedence (prefer the registering account's own
player, collapse a shadow player's handle onto it, walk declared smurfs) stays
there -- a tag typed into the mix roster carries no claim of ownership.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.core import http_status as status
from shared.core.errors import BaseAPIException as HTTPException
from shared.core.social import SocialProvider, normalize_social_handle
from shared.repository import UserRepository, get_or_create_workspace_member
from shared.services import social_identity
from shared.services.team_export.identity import find_users_by_battle_tags

__all__ = ("RosterMember", "ensure_member_for_battle_tag", "list_roster", "roster_page")


@dataclass(frozen=True, slots=True)
class RosterMember:
    """One roster row: the membership, its player, and the tag it is known by."""

    member_id: int
    player_id: int
    battle_tag: str | None
    display_name: str | None


def _main_battle_tag() -> sa.ScalarSelect[str]:
    """The player's primary battlenet handle, as a correlated scalar.

    A scalar subquery rather than a join: a player with declared smurfs owns
    several battlenet rows, and joining them would multiply the roster.
    """
    return (
        sa.select(models.SocialAccount.username)
        .where(
            models.SocialAccount.user_id == models.User.id,
            models.SocialAccount.provider == SocialProvider.BATTLENET,
        )
        .order_by(models.SocialAccount.is_primary.desc(), models.SocialAccount.id.asc())
        .limit(1)
        .correlate(models.User)
        .scalar_subquery()
    )


def _filters(
    workspace_id: int,
    search: str | None,
    *,
    author_user_id: int | None = None,
    author_only: bool = False,
) -> list[sa.ColumnElement[bool]]:
    filters: list[sa.ColumnElement[bool]] = [models.WorkspaceMember.workspace_id == workspace_id]
    if author_only and author_user_id is not None:
        # The "My ranks" shortcut: only members this author has personally
        # corrected -- the book that outranks the canon when *their* mixes
        # are balanced (see ``shared.models.member_rank.MemberRank``).
        filters.append(
            sa.exists().where(
                models.MemberRank.workspace_id == workspace_id,
                models.MemberRank.workspace_member_id == models.WorkspaceMember.id,
                models.MemberRank.author_user_id == author_user_id,
            )
        )
    needle = (search or "").strip()
    if not needle:
        return filters
    like = f"%{needle}%"
    # ``username_normalized`` is casefolded and space-free, so the needle has to
    # be put through the same normalizer to match "Foo # 1234" against "foo#1234".
    normalized = f"%{normalize_social_handle(SocialProvider.BATTLENET, needle)}%"
    filters.append(
        sa.or_(
            models.WorkspaceMember.display_name.ilike(like),
            models.User.name.ilike(like),
            sa.exists().where(
                models.SocialAccount.user_id == models.User.id,
                models.SocialAccount.provider == SocialProvider.BATTLENET,
                models.SocialAccount.username_normalized.like(normalized),
            ),
        )
    )
    return filters


async def roster_page(
    session: AsyncSession,
    *,
    workspace_id: int,
    search: str | None = None,
    page: int = 1,
    per_page: int = 30,
    author_user_id: int | None = None,
    author_only: bool = False,
) -> tuple[list[RosterMember], int]:
    """One page of the workspace roster, newest-agnostic (ordered by member id)."""
    filters = _filters(workspace_id, search, author_user_id=author_user_id, author_only=author_only)
    joined = sa.select(models.WorkspaceMember.id).join(
        models.User, models.User.id == models.WorkspaceMember.player_id
    )
    total = await session.scalar(
        sa.select(sa.func.count()).select_from(joined.where(*filters).subquery())
    )
    result = await session.execute(
        sa.select(
            models.WorkspaceMember.id,
            models.WorkspaceMember.player_id,
            models.WorkspaceMember.display_name,
            models.User.name,
            _main_battle_tag(),
        )
        .join(models.User, models.User.id == models.WorkspaceMember.player_id)
        .where(*filters)
        .order_by(models.WorkspaceMember.id.asc())
        .limit(per_page)
        .offset(max(page - 1, 0) * per_page)
    )
    rows = [
        RosterMember(
            member_id=member_id,
            player_id=player_id,
            battle_tag=battle_tag,
            display_name=display_name or player_name,
        )
        for member_id, player_id, display_name, player_name, battle_tag in result.all()
    ]
    return rows, int(total or 0)


async def list_roster(
    session: AsyncSession, *, workspace_id: int, member_ids: Sequence[int]
) -> dict[int, RosterMember]:
    """Named roster rows for an explicit set of members (a mix lineup)."""
    if not member_ids:
        return {}
    result = await session.execute(
        sa.select(
            models.WorkspaceMember.id,
            models.WorkspaceMember.player_id,
            models.WorkspaceMember.display_name,
            models.User.name,
            _main_battle_tag(),
        )
        .join(models.User, models.User.id == models.WorkspaceMember.player_id)
        .where(
            models.WorkspaceMember.workspace_id == workspace_id,
            models.WorkspaceMember.id.in_(list(member_ids)),
        )
    )
    return {
        member_id: RosterMember(
            member_id=member_id,
            player_id=player_id,
            battle_tag=battle_tag,
            display_name=display_name or player_name,
        )
        for member_id, player_id, display_name, player_name, battle_tag in result.all()
    }


async def ensure_member_for_battle_tag(
    session: AsyncSession,
    *,
    workspace_id: int,
    battle_tag: str,
    display_name: str | None = None,
) -> models.WorkspaceMember:
    """Find-or-create the membership a BattleTag denotes in this workspace.

    The player row is deliberately created without ``auth_user_id``: a tag typed
    into the roster is somebody the host is ranking, not the host's own account,
    and ``get_or_create_workspace_member`` only hands out the baseline RBAC role
    to auth-linked players -- so this never grants anybody workspace access.
    """
    tag = (battle_tag or "").strip()
    if not tag:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="battle_tag is required")

    found = await find_users_by_battle_tags(session, [tag])
    user = found.get(tag)
    if user is None:
        user = await UserRepository().create(session, models.User(name=tag))
    await social_identity.upsert_social_account(
        session, user_id=user.id, provider=SocialProvider.BATTLENET, username=tag
    )
    member = await get_or_create_workspace_member(session, workspace_id=workspace_id, player_id=user.id)
    if display_name is not None:
        member.display_name = display_name or None
        await session.flush()
    return member
