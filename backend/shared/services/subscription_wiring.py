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

from sqlalchemy.ext.asyncio import AsyncSession

from shared.core.social import SocialProvider
from shared.services.subscription_entitlements import (
    EntitlementStore,
    ProviderStrategy,
    SubscriptionResolver,
)
from shared.services.subscription_store import SqlEntitlementStore
from shared.services.subscription_strategies import (
    BoostyDiscordStrategy,
    TwitchSubscriptionStrategy,
)

__all__ = ("build_resolver", "build_store", "build_strategies")


def build_store(session: AsyncSession) -> EntitlementStore:
    return SqlEntitlementStore(session)


def build_strategies(
    session: AsyncSession,
    *,
    discord_bot_token: str | None = None,
    twitch_client_id: str | None = None,
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
        SocialProvider.BOOSTY: BoostyDiscordStrategy(session, bot_token=discord_bot_token, proxy=proxy),
        SocialProvider.TWITCH: TwitchSubscriptionStrategy(session, client_id=twitch_client_id, proxy=proxy),
    }


def build_resolver(
    session: AsyncSession,
    *,
    discord_bot_token: str | None = None,
    twitch_client_id: str | None = None,
    proxy: str | None = None,
) -> SubscriptionResolver:
    return SubscriptionResolver(
        store=build_store(session),
        strategies=build_strategies(
            session,
            discord_bot_token=discord_bot_token,
            twitch_client_id=twitch_client_id,
            proxy=proxy,
        ),
    )
