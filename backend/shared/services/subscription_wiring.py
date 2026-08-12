"""Build a ready-to-use ``SubscriptionResolver``.

Also the place where conformance to the ports is proven *statically*: these
factories are annotated to return ``EntitlementStore`` / ``ProviderStrategy``, so
mypy checks the SQL store and the real strategies against the protocols the
resolver depends on. Without an annotated assignment somewhere, a wrong signature
would only surface at runtime.

Credentials arrive as arguments -- ``shared`` is imported by every service and
must not read any single service's settings.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from shared.core.social import SocialProvider
from shared.services.subscription_entitlements import (
    CheckLogSink,
    EntitlementStore,
    ProviderStrategy,
    SubscriptionEventSink,
    SubscriptionResolver,
)
from shared.services.subscription_realtime import RedisSubscriptionEventSink
from shared.services.subscription_store import SqlCheckLogSink, SqlEntitlementStore
from shared.services.subscription_strategies import (
    BoostyDiscordStrategy,
    TwitchSubscriptionStrategy,
)

__all__ = ("build_event_sink", "build_log_sink", "build_resolver", "build_store", "build_strategies")


def build_log_sink(session: AsyncSession) -> CheckLogSink:
    return SqlCheckLogSink(session)


def build_event_sink(redis: Any | None) -> SubscriptionEventSink | None:
    """Realtime invalidation sink, or ``None`` when the caller has no Redis.

    Optional rather than required so a test (or a CLI one-off) can build a working
    resolver with nothing but a session: no sink means no signal, and every
    admission decision is unaffected.
    """
    return RedisSubscriptionEventSink(redis) if redis is not None else None


def build_store(session: AsyncSession) -> EntitlementStore:
    return SqlEntitlementStore(session)


def build_strategies(
    session: AsyncSession,
    *,
    discord_bot_token: str | None = None,
    twitch_client_id: str | None = None,
    broker: Any | None = None,
    proxy: str | None = None,
) -> dict[str, ProviderStrategy]:
    """Map ``provider`` -> live resolution strategy.

    Keys are the entitlement providers stored in ``provider_config.provider``
    (``boosty``/``twitch``), not the mechanism used to answer: Boosty's tier comes
    from Discord roles, which is an implementation detail recorded in the
    verdict's ``source``.

    A provider with no credentials is still registered: its strategy resolves to
    ``unknown`` (fail open) with a reason, which is strictly better than the
    resolver reporting ``no_strategy_for_provider`` and hiding the real cause.
    """
    return {
        SocialProvider.BOOSTY: BoostyDiscordStrategy(session, bot_token=discord_bot_token, broker=broker, proxy=proxy),
        SocialProvider.TWITCH: TwitchSubscriptionStrategy(session, client_id=twitch_client_id, proxy=proxy),
    }


def build_resolver(
    session: AsyncSession,
    *,
    discord_bot_token: str | None = None,
    twitch_client_id: str | None = None,
    broker: Any | None = None,
    proxy: str | None = None,
    redis: Any | None = None,
) -> SubscriptionResolver:
    return SubscriptionResolver(
        store=build_store(session),
        strategies=build_strategies(
            session,
            discord_bot_token=discord_bot_token,
            twitch_client_id=twitch_client_id,
            broker=broker,
            proxy=proxy,
        ),
        # Every real resolver records history: the collector needs it for the admin
        # tab, and the registration/check-in gates are exactly the checks an
        # organizer later asks "why was this player refused?" about.
        log_sink=build_log_sink(session),
        # ...and tells the workspace when a verdict actually moved, so an open page
        # shows it without polling. Absent Redis, silently no signal.
        event_sink=build_event_sink(redis),
    )
