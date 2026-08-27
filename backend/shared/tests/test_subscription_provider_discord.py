"""Discord-role provider tests.

Runs under stdlib unittest (no pytest-asyncio in this repo — see
shared/tests/test_rpc_crud.py for the same convention). Discord is injected as
two async callables, so nothing here touches the network.
"""

from __future__ import annotations

from unittest import IsolatedAsyncioTestCase

from shared.services.subscriptions import SubscriptionSource, SubscriptionState
from shared.services.subscriptions.providers.discord_role import (
    DiscordForbidden,
    DiscordNotConfigured,
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

    async def test_our_own_missing_bot_token_is_not_reported_as_a_guild_fault(self):
        """A service deployed without DISCORD_TOKEN used to answer
        ``guild_not_accessible``, which reads as "bot cannot read the guild" and sent
        the operator to inspect a guild id that was perfectly correct. The reason must
        name the credential, not the guild."""
        verdict = await _resolve(_Harness(member_error=DiscordNotConfigured("no bot token")))
        assert verdict.state == SubscriptionState.UNKNOWN
        assert verdict.evidence["reason"] == "bot_not_configured"

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


def _rpc_reply(body):
    """A FastStream RPC reply: ``broker.request`` hands back the MESSAGE.

    Mocking it as a bare dict is what let the un-decoded ``isinstance(res, dict)``
    check ship green while every real call took the fallback path.
    """
    from unittest.mock import AsyncMock, MagicMock

    return MagicMock(decode=AsyncMock(return_value=body))


class TestBoostyDiscordStrategyRPC(IsolatedAsyncioTestCase):
    async def test_resolve_many_uses_rpc_when_available(self):
        from unittest.mock import AsyncMock, patch

        from shared.services.subscriptions.strategies import BoostyDiscordStrategy

        fake_broker = AsyncMock()
        fake_broker.request.return_value = _rpc_reply(
            {
                "guild_role_ids": ["100", "200"],
                "members": {
                    "discord-id-1": {"found": True, "roles": ["200"]},
                    "discord-id-2": {"found": False, "roles": []},
                },
            }
        )

        session = AsyncMock()
        strategy = BoostyDiscordStrategy(session, bot_token="token", broker=fake_broker)

        with patch(
            "shared.services.subscriptions.strategies.load_provider_user_ids",
            AsyncMock(return_value={1: ["discord-id-1"], 2: ["discord-id-2"]}),
        ):
            verdicts = await strategy.resolve_many(config=CONFIG, auth_user_ids=[1, 2])

        fake_broker.request.assert_awaited_once()
        assert verdicts[1].state == SubscriptionState.ACTIVE
        assert verdicts[1].tier_rank == 2
        assert verdicts[2].state == SubscriptionState.INACTIVE

    async def test_resolve_many_reports_unlinked_user_without_rpc_lookup(self):
        """A user with no Discord link is never asked about over RPC."""
        from unittest.mock import AsyncMock, patch

        from shared.services.subscriptions.strategies import BoostyDiscordStrategy

        fake_broker = AsyncMock()
        fake_broker.request.return_value = _rpc_reply(
            {"guild_role_ids": ["100", "200"], "members": {"discord-id-1": {"found": True, "roles": ["200"]}}}
        )

        strategy = BoostyDiscordStrategy(AsyncMock(), bot_token="token", broker=fake_broker)
        with patch(
            "shared.services.subscriptions.strategies.load_provider_user_ids",
            AsyncMock(return_value={1: ["discord-id-1"]}),
        ):
            verdicts = await strategy.resolve_many(config=CONFIG, auth_user_ids=[1, 7])

        assert verdicts[1].state == SubscriptionState.ACTIVE
        assert verdicts[7].state == SubscriptionState.UNKNOWN
        assert verdicts[7].evidence["reason"] == "no_linked_discord_account"
        sent = fake_broker.request.await_args.args[0]
        assert sent["user_ids"] == ["discord-id-1"]

    async def test_resolve_many_falls_back_to_http_when_rpc_fails(self):
        from unittest.mock import AsyncMock, patch

        from shared.services.subscriptions.strategies import BoostyDiscordStrategy

        fake_broker = AsyncMock()
        fake_broker.request.side_effect = RuntimeError("Broker error")

        session = AsyncMock()
        strategy = BoostyDiscordStrategy(session, bot_token="token", broker=fake_broker)

        dummy_resolver = AsyncMock()
        dummy_resolver.resolve.return_value = AsyncMock(state=SubscriptionState.ACTIVE)

        with (
            patch(
                "shared.services.subscriptions.strategies.load_provider_user_ids",
                AsyncMock(return_value={1: ["discord-id-1"]}),
            ),
            patch(
                "shared.services.subscriptions.strategies.DiscordRoleResolver",
                return_value=dummy_resolver,
            ),
        ):
            verdicts = await strategy.resolve_many(config=CONFIG, auth_user_ids=[1])

        fake_broker.request.assert_awaited_once()
        assert 1 in verdicts

    async def test_resolve_many_falls_back_when_peer_answers_with_an_error(self):
        """``guild_not_found`` from discord-service must not be read as a verdict."""
        from unittest.mock import AsyncMock, patch

        from shared.services.subscriptions.strategies import BoostyDiscordStrategy

        fake_broker = AsyncMock()
        fake_broker.request.return_value = _rpc_reply({"error": "guild_not_found", "guild_role_ids": [], "members": {}})

        strategy = BoostyDiscordStrategy(AsyncMock(), bot_token="token", broker=fake_broker)
        dummy_resolver = AsyncMock()
        dummy_resolver.resolve.return_value = AsyncMock(state=SubscriptionState.ACTIVE)

        with (
            patch(
                "shared.services.subscriptions.strategies.load_provider_user_ids",
                AsyncMock(return_value={1: ["discord-id-1"]}),
            ),
            patch(
                "shared.services.subscriptions.strategies.DiscordRoleResolver",
                return_value=dummy_resolver,
            ),
        ):
            verdicts = await strategy.resolve_many(config=CONFIG, auth_user_ids=[1])

        dummy_resolver.resolve.assert_awaited()
        assert 1 in verdicts


class TestSeveralLinkedDiscordAccounts(IsolatedAsyncioTestCase):
    """A patron may pay from any of their linked Discord accounts."""

    async def _resolve(self, members: dict, account_ids: list[str], guild_role_ids=("100", "200")):
        from unittest.mock import AsyncMock, patch

        from shared.services.subscriptions.strategies import BoostyDiscordStrategy

        fake_broker = AsyncMock()
        fake_broker.request.return_value = _rpc_reply({"guild_role_ids": list(guild_role_ids), "members": members})
        strategy = BoostyDiscordStrategy(AsyncMock(), bot_token="token", broker=fake_broker)
        with patch(
            "shared.services.subscriptions.strategies.load_provider_user_ids",
            AsyncMock(return_value={1: account_ids}),
        ):
            verdicts = await strategy.resolve_many(config=CONFIG, auth_user_ids=[1])
        return verdicts[1], fake_broker.request.await_args.args[0]

    async def test_the_subscribed_account_wins_over_the_first_linked_one(self):
        verdict, sent = await self._resolve(
            {"first": {"found": False, "roles": []}, "second": {"found": True, "roles": ["200"]}},
            ["first", "second"],
        )
        assert verdict.state == SubscriptionState.ACTIVE
        assert verdict.tier_rank == 2
        # The audit trail has to name the account that answered, now that several could.
        assert verdict.evidence["resolved_account_id"] == "second"
        assert verdict.evidence["accounts_checked"] == 2
        # Every linked account is asked about in the one batch RPC.
        assert sent["user_ids"] == ["first", "second"]

    async def test_the_highest_tier_held_across_accounts_wins(self):
        verdict, _ = await self._resolve(
            {"first": {"found": True, "roles": ["100"]}, "second": {"found": True, "roles": ["200"]}},
            ["first", "second"],
        )
        assert (verdict.state, verdict.tier_rank) == (SubscriptionState.ACTIVE, 2)

    async def test_an_unresolvable_account_is_not_overruled_by_a_non_member_sibling(self):
        """``unknown`` fails open, so it must outrank a sibling's confirmed ``inactive``.

        Otherwise one account dropping out of the guild would lock out a patron whose
        other account we simply could not read.
        """
        verdict, _ = await self._resolve(
            {"first": {"found": False, "roles": []}, "second": {"found": True, "roles": ["555"]}},
            ["first", "second"],
            # Tier role "200" vanished from the guild, so the member account cannot be
            # judged -> unknown, while the other account is a confirmed non-member.
            guild_role_ids=("100",),
        )
        assert verdict.state == SubscriptionState.UNKNOWN
        assert verdict.evidence["reason"] == "role_mapping_drift"
