"""Subscription Collection Service.

Periodically queries active/open tournaments that require subscriptions, collects
the auth_user_ids of registered participants, and runs SubscriptionResolver to check
and update their entitlements in Postgres.

Each resolved attempt also appends a row to ``subscriptions.check_log`` (via the
resolver's log sink), which is what makes the collection history visible in the
admin Subscription-collection tab.
"""

from __future__ import annotations

from dataclasses import dataclass

import sqlalchemy as sa
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.core.enums import SubscriptionCollectionSource
from shared.services.subscription_wiring import build_resolver
from shared.subscriptions import parse_requirement

__all__ = (
    "TournamentTarget",
    "collect_subscriptions_for_active_tournaments",
    "find_tournaments_requiring_subscriptions",
    "load_auth_user_ids_for_tournament",
)


@dataclass(frozen=True, slots=True)
class TournamentTarget:
    """One tournament the collector should sweep, with the rule it must check.

    ``providers`` comes from the form's own requirement rather than a hardcoded
    list: resolving a provider the tournament does not require costs a provider
    call, persists an entitlement nobody reads, and — now that attempts are
    logged — buries the real history under ``provider_not_configured`` noise.
    """

    tournament_id: int
    workspace_id: int
    providers: tuple[str, ...]


def _chunked(items: list[int], size: int) -> list[list[int]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


async def find_tournaments_requiring_subscriptions(session: AsyncSession) -> list[TournamentTarget]:
    """Active, open tournaments whose registration form enforces a subscription.

    Forms whose requirement is empty or malformed are dropped here rather than
    later: ``require_subscription`` is a master toggle kept separate from the
    rule blob, so it can legitimately be on while the blob is still empty, and
    there is nothing to check for such a tournament.
    """
    stmt = (
        sa.select(
            models.Tournament.id,
            models.Tournament.workspace_id,
            models.BalancerRegistrationForm.subscription_requirement_json,
        )
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
    targets: list[TournamentTarget] = []
    for tournament_id, workspace_id, blob in (await session.execute(stmt)).all():
        try:
            requirement = parse_requirement(blob)
        except ValueError:
            logger.warning(
                "Skipping subscription collection for tournament_id={}: malformed requirement",
                tournament_id,
            )
            continue
        if not requirement.requirements:
            continue
        targets.append(
            TournamentTarget(
                tournament_id=tournament_id,
                workspace_id=workspace_id,
                providers=tuple(requirement.providers),
            )
        )
    return targets


async def load_auth_user_ids_for_tournament(session: AsyncSession, tournament_id: int) -> list[int]:
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
    batch_size: int = 50,
    source: str = SubscriptionCollectionSource.scheduled,
) -> int:
    """Check and update subscriptions for participants in active tournaments requiring subscriptions.

    Commits per batch. Without a commit nothing survives the session — neither the
    entitlement upserts nor the history rows — and a single long transaction over
    every participant of every open tournament would hold locks for the whole
    sweep. Committing per batch also means a provider outage halfway through keeps
    the work already done.

    Returns the total number of users processed.
    """
    targets = await find_tournaments_requiring_subscriptions(session)
    if not targets:
        return 0

    resolver = build_resolver(
        session,
        discord_bot_token=discord_bot_token,
        twitch_client_id=twitch_client_id,
        proxy=proxy,
    )

    total_processed = 0

    for target in targets:
        auth_user_ids = await load_auth_user_ids_for_tournament(session, target.tournament_id)
        if not auth_user_ids:
            continue

        for batch in _chunked(auth_user_ids, max(1, batch_size)):
            try:
                results = await resolver.resolve(
                    workspace_id=target.workspace_id,
                    auth_user_ids=batch,
                    providers=list(target.providers),
                    force_refresh=True,
                    source=source,
                )
                await session.commit()
                total_processed += len(results)
            except Exception as exc:
                # One tournament's provider trouble must not abort the sweep. The
                # rollback is what lets the next batch reuse the session.
                await session.rollback()
                logger.error(
                    "Error processing subscription collection for tournament_id={}: {}",
                    target.tournament_id,
                    exc,
                )
                break

        logger.info(
            "Collected subscriptions for tournament_id={}, workspace_id={}, users_count={}",
            target.tournament_id,
            target.workspace_id,
            len(auth_user_ids),
        )

    return total_processed
