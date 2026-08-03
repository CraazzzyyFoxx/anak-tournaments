"""Discord-role provider tests.

Runs under stdlib unittest (no pytest-asyncio in this repo — see
shared/tests/test_rpc_crud.py for the same convention). Discord is injected as
two async callables, so nothing here touches the network.
"""

from __future__ import annotations

from unittest import IsolatedAsyncioTestCase

from shared.subscriptions import SubscriptionSource, SubscriptionState
from shared.subscriptions.providers.discord_role import (
    DiscordForbidden,
    DiscordRoleResolver,
    DiscordUnavailable,
    MemberNotFound,
)

CONFIG = {
    "guild_id": "999",
    "role_tiers": [
        {"role_id": "100", "tier_rank": 1, "tier_label": "Уровень 1"},
        {"role_id": "200", "tier_rank": 2, "tier_label": "Уровень 2"},
    ],
}

# Every mapped role still exists in the guild — the healthy case.
HEALTHY_GUILD_ROLES = {"100", "200", "555"}


class _Harness:
    """Fake Discord: records call counts, raises what the test asks for."""

    def __init__(
        self,
        *,
        member_roles: list[str] | None = None,
        guild_roles: set[str] | None = None,
        member_error: Exception | None = None,
        guild_error: Exception | None = None,
    ) -> None:
        self.member_roles = member_roles or []
        self.guild_roles = HEALTHY_GUILD_ROLES if guild_roles is None else guild_roles
        self.member_error = member_error
        self.guild_error = guild_error
        self.member_calls = 0
        self.guild_calls = 0

    async def fetch_member_roles(self, guild_id: str, user_id: str) -> list[str]:
        self.member_calls += 1
        if self.member_error is not None:
            raise self.member_error
        return list(self.member_roles)

    async def fetch_guild_role_ids(self, guild_id: str) -> set[str]:
        self.guild_calls += 1
        if self.guild_error is not None:
            raise self.guild_error
        return set(self.guild_roles)

    def resolver(self) -> DiscordRoleResolver:
        return DiscordRoleResolver(
            fetch_member_roles=self.fetch_member_roles,
            fetch_guild_role_ids=self.fetch_guild_role_ids,
        )


async def _resolve(harness: _Harness, *, discord_user_id="42", config=None, resolver=None):
    return await (resolver or harness.resolver()).resolve(
        config=CONFIG if config is None else config,
        discord_user_id=discord_user_id,
    )


class TestActive(IsolatedAsyncioTestCase):
    async def test_member_with_mapped_role_is_active(self):
        verdict = await _resolve(_Harness(member_roles=["200"]))
        assert verdict.state == SubscriptionState.ACTIVE
        assert verdict.tier_rank == 2
        assert verdict.tier_label == "Уровень 2"
        assert verdict.source == SubscriptionSource.DISCORD_ROLE

    async def test_highest_tier_wins_when_member_holds_several(self):
        """Boosty leaves the lower role attached after an upgrade."""
        verdict = await _resolve(_Harness(member_roles=["100", "200"]))
        assert verdict.tier_rank == 2

    async def test_evidence_records_matched_and_held_roles(self):
        verdict = await _resolve(_Harness(member_roles=["100", "200", "555"]))
        assert verdict.evidence["matched_role_id"] == "200"
        assert set(verdict.evidence["held_role_ids"]) == {"100", "200", "555"}


class TestInactive(IsolatedAsyncioTestCase):
    async def test_member_without_any_mapped_role_is_inactive(self):
        verdict = await _resolve(_Harness(member_roles=["555"]))
        assert verdict.state == SubscriptionState.INACTIVE
        assert verdict.tier_rank is None

    async def test_member_with_no_roles_is_inactive(self):
        verdict = await _resolve(_Harness(member_roles=[]))
        assert verdict.state == SubscriptionState.INACTIVE

    async def test_user_not_in_guild_is_inactive(self):
        """404 means "not a member", a genuine "not subscribed" — and 404s do not
        count toward Discord's invalid-request ban budget."""
        verdict = await _resolve(_Harness(member_error=MemberNotFound("404")))
        assert verdict.state == SubscriptionState.INACTIVE
        assert verdict.evidence["reason"] == "not_a_member"


class TestUnknownFailsOpen(IsolatedAsyncioTestCase):
    async def test_missing_discord_user_id_is_unknown_without_any_call(self):
        harness = _Harness()
        verdict = await _resolve(harness, discord_user_id=None)
        assert verdict.state == SubscriptionState.UNKNOWN
        assert verdict.evidence["reason"] == "no_linked_discord_account"
        assert (harness.member_calls, harness.guild_calls) == (0, 0)

    async def test_missing_guild_id_is_unknown_without_any_call(self):
        harness = _Harness()
        verdict = await _resolve(harness, config={"role_tiers": CONFIG["role_tiers"]})
        assert verdict.state == SubscriptionState.UNKNOWN
        assert verdict.evidence["reason"] == "guild_not_configured"
        assert (harness.member_calls, harness.guild_calls) == (0, 0)

    async def test_no_role_tiers_configured_is_unknown_without_any_call(self):
        harness = _Harness()
        verdict = await _resolve(harness, config={"guild_id": "999"})
        assert verdict.state == SubscriptionState.UNKNOWN
        assert verdict.evidence["reason"] == "no_role_tiers_configured"
        assert (harness.member_calls, harness.guild_calls) == (0, 0)

    async def test_bot_missing_from_guild_is_unknown(self):
        """403 is an organizer misconfiguration; refusing everyone would be wrong."""
        verdict = await _resolve(_Harness(member_error=DiscordForbidden("403")))
        assert verdict.state == SubscriptionState.UNKNOWN
        assert verdict.evidence["reason"] == "guild_not_accessible"

    async def test_discord_outage_is_unknown(self):
        verdict = await _resolve(_Harness(member_error=DiscordUnavailable("503")))
        assert verdict.state == SubscriptionState.UNKNOWN
        assert verdict.evidence["reason"] == "provider_unavailable"

    async def test_guild_role_fetch_failure_is_unknown(self):
        verdict = await _resolve(_Harness(member_roles=["555"], guild_error=DiscordUnavailable("503")))
        assert verdict.state == SubscriptionState.UNKNOWN

    async def test_every_unknown_carries_a_reason(self):
        """The UI branches on evidence['reason'] to pick a call to action."""
        cases = [
            _Harness(member_error=DiscordForbidden("403")),
            _Harness(member_error=DiscordUnavailable("503")),
            _Harness(member_roles=["555"], guild_error=DiscordUnavailable("503")),
            _Harness(member_roles=["555"], guild_roles={"555"}),
        ]
        for harness in cases:
            verdict = await _resolve(harness)
            assert verdict.state == SubscriptionState.UNKNOWN
            assert verdict.evidence.get("reason"), f"missing reason for {harness.member_error}"


class TestMappingDrift(IsolatedAsyncioTestCase):
    async def test_mapped_role_absent_from_guild_is_unknown_not_inactive(self):
        """If the organizer deleted or re-created the role, every patron would
        otherwise silently read as 'not subscribed'."""
        verdict = await _resolve(_Harness(member_roles=["555"], guild_roles={"555"}))
        assert verdict.state == SubscriptionState.UNKNOWN
        assert verdict.evidence["reason"] == "role_mapping_drift"
        assert set(verdict.evidence["missing_role_ids"]) == {"100", "200"}

    async def test_partial_drift_is_still_unknown_when_no_role_matched(self):
        verdict = await _resolve(_Harness(member_roles=["555"], guild_roles={"100", "555"}))
        assert verdict.state == SubscriptionState.UNKNOWN
        assert set(verdict.evidence["missing_role_ids"]) == {"200"}

    async def test_no_drift_and_no_match_is_inactive(self):
        verdict = await _resolve(_Harness(member_roles=["555"], guild_roles={"100", "200", "555"}))
        assert verdict.state == SubscriptionState.INACTIVE

    async def test_drift_does_not_override_a_positive_match(self):
        """A patron who demonstrably holds a mapped role is active even if some
        *other* mapping is stale — the evidence is already conclusive."""
        verdict = await _resolve(_Harness(member_roles=["100"], guild_roles={"100", "555"}))
        assert verdict.state == SubscriptionState.ACTIVE
        assert verdict.tier_rank == 1

    async def test_guild_roles_are_not_fetched_when_a_role_matched(self):
        """The drift check only matters for a negative result; skip the call."""
        harness = _Harness(member_roles=["200"])
        await _resolve(harness)
        assert harness.guild_calls == 0
        assert harness.member_calls == 1


class TestGuildRoleMemoization(IsolatedAsyncioTestCase):
    async def test_guild_roles_fetched_once_across_several_users(self):
        """Discord buckets rate limits per guild; N users must not mean N calls."""
        harness = _Harness(member_roles=["555"])
        resolver = harness.resolver()
        for user_id in ("1", "2", "3"):
            await _resolve(harness, discord_user_id=user_id, resolver=resolver)
        assert harness.member_calls == 3
        assert harness.guild_calls == 1

    async def test_a_fresh_resolver_refetches(self):
        """The memo is per-resolver (per batch), never process-global — a stale
        role list must not outlive the request that fetched it."""
        harness = _Harness(member_roles=["555"])
        await _resolve(harness, resolver=harness.resolver())
        await _resolve(harness, resolver=harness.resolver())
        assert harness.guild_calls == 2


class TestVerdictShape(IsolatedAsyncioTestCase):
    async def test_source_is_always_discord_role(self):
        for harness in (
            _Harness(member_roles=["200"]),
            _Harness(member_roles=["555"]),
            _Harness(member_error=DiscordUnavailable("boom")),
        ):
            verdict = await _resolve(harness)
            assert verdict.source == SubscriptionSource.DISCORD_ROLE

    async def test_checked_at_is_timezone_aware(self):
        verdict = await _resolve(_Harness(member_roles=["200"]))
        assert verdict.checked_at.tzinfo is not None

    async def test_expires_at_is_set_and_in_the_future(self):
        verdict = await _resolve(_Harness(member_roles=["200"]))
        assert verdict.expires_at is not None
        assert verdict.expires_at > verdict.checked_at
