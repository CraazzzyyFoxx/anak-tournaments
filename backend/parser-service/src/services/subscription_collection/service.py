"""Subscription Collection Service.

Periodically queries active/open tournaments that require subscriptions, collects
the auth_user_ids of registered participants, and runs SubscriptionResolver to check
and update their entitlements in Postgres.
"""

from __future__ import annotations

from typing import Any, Sequence
from loguru import logger
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.services.subscription_wiring import build_resolver


async def find_tournaments_requiring_subscriptions(session: AsyncSession) -> list[tuple[int, int]]:
    """Return list of (tournament_id, workspace_id) for active tournaments requiring subscriptions."""
    stmt = (
        sa.select(models.Tournament.id, models.Tournament.workspace_id)
        .join(
            models.BalancerRegistrationForm,
            models.Tournament.id == models.BalancerRegistrationForm.tournament_id,
        )
        .where(
            models.Tournament.is_finished.is_(False),
            models.BalancerRegistrationForm.require_subscription.is_(True),
            models.BalancerRegistrationForm.is_open.is_(True),
        )
    )
    result = await session.execute(stmt)
    return [(row[0], row[1]) for row in result.all()]


async def load_auth_user_ids_for_tournament(
    session: AsyncSession, tournament_id: int
) -> list[int]:
    """Get all auth_user_ids for registered participants in a tournament."""
    stmt = (
        sa.select(models.User.auth_user_id)
        .select_from(models.BalancerRegistration)
        .join(
            models.WorkspaceMember,
            models.BalancerRegistration.workspace_member_id == models.WorkspaceMember.id,
        )
        .join(models.User, models.WorkspaceMember.player_id == models.User.id)
        .where(
            models.BalancerRegistration.tournament_id == tournament_id,
            models.BalancerRegistration.deleted_at.is_(None),
            models.BalancerRegistration.status != "withdrawn",
            models.User.auth_user_id.isnot(None),
        )
        .distinct()
    )
    result = await session.execute(stmt)
    return [row[0] for row in result.all() if row[0] is not None]


async def collect_subscriptions_for_active_tournaments(
    session: AsyncSession,
    *,
    discord_bot_token: str | None = None,
    twitch_client_id: str | None = None,
    proxy: str | None = None,
) -> int:
    """Check and update subscriptions for participants in active tournaments requiring subscriptions.

    Returns the total number of users processed.
    """
    tournaments = await find_tournaments_requiring_subscriptions(session)
    if not tournaments:
        return 0

    resolver = build_resolver(
        session,
        discord_bot_token=discord_bot_token,
        twitch_client_id=twitch_client_id,
        proxy=proxy,
    )

    total_processed = 0

    for tournament_id, workspace_id in tournaments:
        auth_user_ids = await load_auth_user_ids_for_tournament(session, tournament_id)
        if not auth_user_ids:
            continue

        try:
            results = await resolver.resolve(
                workspace_id=workspace_id,
                auth_user_ids=auth_user_ids,
                providers=["boosty", "twitch"],
                force_refresh=True,
            )
            total_processed += len(results)
            logger.info(
                "Collected subscriptions for tournament_id={}, workspace_id={}, users_count={}",
                tournament_id,
                workspace_id,
                len(results),
            )
        except Exception as exc:
            logger.error(
                "Error processing subscription collection for tournament_id={}: {}",
                tournament_id,
                exc,
            )

    return total_processed
