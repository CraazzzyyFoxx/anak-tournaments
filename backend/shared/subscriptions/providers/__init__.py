"""Subscription providers.

Each module turns one external signal into a ``SubscriptionVerdict``. External
I/O is injected as callables so every decision path is unit-testable without a
network, a bot token, or a live OAuth session.
"""

from shared.subscriptions.providers.discord_role import (
    DiscordForbidden,
    DiscordRoleResolver,
    DiscordUnavailable,
    MemberNotFound,
)
from shared.subscriptions.providers.twitch_helix import (
    HelixForbidden,
    HelixMissingScope,
    HelixNotFound,
    HelixUnavailable,
    TwitchHelixResolver,
)

__all__ = (
    "DiscordForbidden",
    "DiscordRoleResolver",
    "DiscordUnavailable",
    "HelixForbidden",
    "HelixMissingScope",
    "HelixNotFound",
    "HelixUnavailable",
    "MemberNotFound",
    "TwitchHelixResolver",
)
