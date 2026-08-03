"""Boosty subscription tiers derived from Discord roles.

Boosty has no third-party OAuth and no public API, but it ships an OFFICIAL
Discord integration: the author connects Boosty's own bot to their server and
maps each subscription level to a Discord role. This resolver reads the patron's
roles in that guild and maps them back to a tier.

Ownership of the account is already proven by our own Discord OAuth (the patron's
``provider_user_id``), and the subscription itself is asserted by Boosty's bot --
so no reverse-engineering and no new user-facing scope.

Discord access notes (verified against the API docs, see the design doc):

- ``GET /guilds/{guild}/members/{user}`` needs NO privileged intent. Do not use
  the *list* endpoint, which does.
- Rate limits bucket per ``guild_id``, so the guild's role list is fetched at
  most once per resolver instance (one batch) and only when it is actually
  needed.
- Without the ``GUILD_MEMBERS`` intent there are no ``GUILD_MEMBER_UPDATE``
  events, so this is strictly pull-based: verdicts carry a TTL.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any, Final

from shared.subscriptions.discord_roles import parse_role_tiers, resolve_role_tier
from shared.subscriptions.types import (
    SubscriptionSource,
    SubscriptionState,
    SubscriptionVerdict,
)

__all__ = (
    "DEFAULT_TTL_SECONDS",
    "DiscordForbidden",
    "DiscordRoleResolver",
    "DiscordUnavailable",
    "MemberNotFound",
)

DEFAULT_TTL_SECONDS: Final = 15 * 60

MemberRolesFetcher = Callable[[str, str], Awaitable[list[str]]]
GuildRolesFetcher = Callable[[str], Awaitable[set[str]]]


class DiscordError(Exception):
    """Base for the three outcomes the resolver distinguishes."""


class MemberNotFound(DiscordError):
    """404 -- the user is not a member of the guild, so not subscribed."""


class DiscordForbidden(DiscordError):
    """403 -- the bot cannot see the guild. Organizer misconfiguration."""


class DiscordUnavailable(DiscordError):
    """5xx / timeout / transport failure."""


class DiscordRoleResolver:
    """Resolve one patron's Boosty tier from their Discord roles.

    Discord is injected as two async callables so the whole decision table is
    unit-testable without a network or a bot token. ``fetch_guild_role_ids`` is
    memoized per instance: construct one resolver per batch, never a process-wide
    singleton, or a stale role list would outlive the request that fetched it.
    """

    source = SubscriptionSource.DISCORD_ROLE

    def __init__(
        self,
        *,
        fetch_member_roles: MemberRolesFetcher,
        fetch_guild_role_ids: GuildRolesFetcher,
        ttl_seconds: int = DEFAULT_TTL_SECONDS,
    ) -> None:
        self._fetch_member_roles = fetch_member_roles
        self._fetch_guild_role_ids = fetch_guild_role_ids
        self._ttl_seconds = ttl_seconds
        self._guild_roles_memo: dict[str, set[str]] = {}

    async def resolve(
        self,
        *,
        config: dict[str, Any] | None,
        discord_user_id: str | None,
    ) -> SubscriptionVerdict:
        config = config or {}
        guild_id = str(config.get("guild_id") or "").strip()
        tiers = parse_role_tiers(config)

        # Cheap rejections first: never spend a Discord call on a request that
        # cannot possibly produce a verdict.
        if not guild_id:
            return self._unknown("guild_not_configured")
        if not tiers:
            return self._unknown("no_role_tiers_configured")
        if not discord_user_id:
            return self._unknown("no_linked_discord_account")

        try:
            held_role_ids = await self._fetch_member_roles(guild_id, str(discord_user_id))
        except MemberNotFound:
            return self._inactive("not_a_member")
        except DiscordForbidden:
            return self._unknown("guild_not_accessible")
        except DiscordUnavailable:
            return self._unknown("provider_unavailable")

        held = [str(role_id) for role_id in held_role_ids]
        matched = resolve_role_tier(held, tiers)
        if matched is not None:
            # Conclusive: the patron demonstrably holds a mapped role. A stale
            # mapping elsewhere cannot make this less true, so skip the drift
            # check (and its Discord call) entirely.
            return SubscriptionVerdict(
                state=SubscriptionState.ACTIVE,
                tier_rank=matched.tier_rank,
                tier_label=matched.tier_label or None,
                source=self.source,
                checked_at=self._now(),
                expires_at=self._expiry(),
                evidence={
                    "matched_role_id": matched.role_id,
                    "held_role_ids": held,
                    "guild_id": guild_id,
                },
            )

        # No mapped role held. Before calling that "not subscribed", make sure the
        # mapping still points at roles that exist: if the organizer deleted or
        # re-created a role, EVERY patron would silently read as inactive.
        try:
            guild_role_ids = await self._guild_role_ids(guild_id)
        except DiscordError:
            return self._unknown("provider_unavailable")

        missing = sorted({tier.role_id for tier in tiers} - guild_role_ids)
        if missing:
            return self._unknown(
                "role_mapping_drift",
                missing_role_ids=missing,
                held_role_ids=held,
                guild_id=guild_id,
            )

        return self._inactive(
            "no_mapped_role",
            held_role_ids=held,
            guild_id=guild_id,
        )

    async def _guild_role_ids(self, guild_id: str) -> set[str]:
        cached = self._guild_roles_memo.get(guild_id)
        if cached is None:
            cached = {str(role_id) for role_id in await self._fetch_guild_role_ids(guild_id)}
            self._guild_roles_memo[guild_id] = cached
        return cached

    @staticmethod
    def _now() -> datetime:
        return datetime.now(UTC)

    def _expiry(self) -> datetime:
        return self._now() + timedelta(seconds=self._ttl_seconds)

    def _unknown(self, reason: str, **evidence: Any) -> SubscriptionVerdict:
        return SubscriptionVerdict(
            state=SubscriptionState.UNKNOWN,
            tier_rank=None,
            tier_label=None,
            source=self.source,
            checked_at=self._now(),
            expires_at=self._expiry(),
            evidence={"reason": reason, **evidence},
        )

    def _inactive(self, reason: str, **evidence: Any) -> SubscriptionVerdict:
        return SubscriptionVerdict(
            state=SubscriptionState.INACTIVE,
            tier_rank=None,
            tier_label=None,
            source=self.source,
            checked_at=self._now(),
            expires_at=self._expiry(),
            evidence={"reason": reason, **evidence},
        )
