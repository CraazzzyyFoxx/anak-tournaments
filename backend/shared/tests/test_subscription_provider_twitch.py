"""Twitch Helix provider tests.

Runs under stdlib unittest (no pytest-asyncio in this repo). Helix is injected as
an async callable, so nothing here touches the network.
"""

from __future__ import annotations

from unittest import IsolatedAsyncioTestCase

from shared.subscriptions import SubscriptionSource, SubscriptionState
from shared.subscriptions.providers.twitch_helix import (
    HelixForbidden,
    HelixMissingScope,
    HelixNotFound,
    HelixUnavailable,
    TwitchHelixResolver,
)

CONFIG = {"broadcaster_id": "12345", "broadcaster_login": "streamer"}


class _Harness:
    def __init__(self, *, payload: dict | None = None, error: Exception | None = None) -> None:
        self.payload = payload
        self.error = error
        self.calls: list[tuple[str, str]] = []

    async def check_subscription(self, *, broadcaster_id: str, user_id: str) -> dict:
        self.calls.append((broadcaster_id, user_id))
        if self.error is not None:
            raise self.error
        return self.payload or {}

    def resolver(self) -> TwitchHelixResolver:
        return TwitchHelixResolver(check_subscription=self.check_subscription)


async def _resolve(harness: _Harness, *, twitch_user_id="777", config=None):
    return await harness.resolver().resolve(
        config=CONFIG if config is None else config,
        twitch_user_id=twitch_user_id,
    )


def _sub(tier: str, *, is_gift: bool = False) -> dict:
    """Shape of one Helix `GET /subscriptions/user` data row."""
    return {"data": [{"tier": tier, "is_gift": is_gift, "broadcaster_login": "streamer"}]}


class TestActive(IsolatedAsyncioTestCase):
    async def test_tier_1000_is_rank_1(self):
        verdict = await _resolve(_Harness(payload=_sub("1000")))
        assert verdict.state == SubscriptionState.ACTIVE
        assert verdict.tier_rank == 1
        assert verdict.source == SubscriptionSource.TWITCH_HELIX

    async def test_tier_2000_is_rank_2(self):
        verdict = await _resolve(_Harness(payload=_sub("2000")))
        assert verdict.tier_rank == 2

    async def test_tier_3000_is_rank_3(self):
        verdict = await _resolve(_Harness(payload=_sub("3000")))
        assert verdict.tier_rank == 3

    async def test_gift_is_recorded_but_still_counts(self):
        """A gifted sub is a real sub; the organizer may want to know, so record
        it rather than silently downgrading the verdict."""
        verdict = await _resolve(_Harness(payload=_sub("2000", is_gift=True)))
        assert verdict.state == SubscriptionState.ACTIVE
        assert verdict.evidence["is_gift"] is True

    async def test_unmapped_tier_string_is_active_without_a_rank(self):
        """Twitch documents 1000/2000/3000. An unknown tier still proves a
        subscription, so it must not become `inactive` — it is level >= 1."""
        verdict = await _resolve(_Harness(payload=_sub("9999")))
        assert verdict.state == SubscriptionState.ACTIVE
        assert verdict.tier_rank is None
        assert verdict.evidence["raw_tier"] == "9999"

    async def test_calls_helix_with_configured_broadcaster_and_user(self):
        harness = _Harness(payload=_sub("1000"))
        await _resolve(harness, twitch_user_id="777")
        assert harness.calls == [("12345", "777")]


class TestInactive(IsolatedAsyncioTestCase):
    async def test_empty_data_is_inactive(self):
        verdict = await _resolve(_Harness(payload={"data": []}))
        assert verdict.state == SubscriptionState.INACTIVE

    async def test_missing_data_key_is_inactive(self):
        verdict = await _resolve(_Harness(payload={}))
        assert verdict.state == SubscriptionState.INACTIVE

    async def test_404_is_inactive(self):
        """Helix documents 404 for "not subscribed"."""
        verdict = await _resolve(_Harness(error=HelixNotFound("404")))
        assert verdict.state == SubscriptionState.INACTIVE
        assert verdict.evidence["reason"] == "not_subscribed"


class TestUnknownFailsOpen(IsolatedAsyncioTestCase):
    async def test_missing_twitch_user_id_is_unknown_without_a_call(self):
        harness = _Harness(payload=_sub("1000"))
        verdict = await _resolve(harness, twitch_user_id=None)
        assert verdict.state == SubscriptionState.UNKNOWN
        assert verdict.evidence["reason"] == "no_linked_twitch_account"
        assert harness.calls == []

    async def test_missing_broadcaster_is_unknown_without_a_call(self):
        harness = _Harness(payload=_sub("1000"))
        verdict = await _resolve(harness, config={"broadcaster_login": "streamer"})
        assert verdict.state == SubscriptionState.UNKNOWN
        assert verdict.evidence["reason"] == "broadcaster_not_configured"
        assert harness.calls == []

    async def test_missing_scope_is_unknown_with_a_reconnect_reason(self):
        """Connections predating the scope change must surface a reconnect CTA,
        not a silent failure and not a refusal."""
        verdict = await _resolve(_Harness(error=HelixMissingScope("401")))
        assert verdict.state == SubscriptionState.UNKNOWN
        assert verdict.evidence["reason"] == "missing_scope"

    async def test_broadcaster_not_affiliate_is_unknown(self):
        """Helix 400 when the channel has no subscriptions programme — an
        organizer configuration problem, not the patron's fault."""
        verdict = await _resolve(_Harness(error=HelixForbidden("400")))
        assert verdict.state == SubscriptionState.UNKNOWN
        assert verdict.evidence["reason"] == "broadcaster_not_eligible"

    async def test_outage_is_unknown(self):
        verdict = await _resolve(_Harness(error=HelixUnavailable("503")))
        assert verdict.state == SubscriptionState.UNKNOWN
        assert verdict.evidence["reason"] == "provider_unavailable"

    async def test_every_unknown_carries_a_reason(self):
        for error in (HelixMissingScope("x"), HelixForbidden("x"), HelixUnavailable("x")):
            verdict = await _resolve(_Harness(error=error))
            assert verdict.state == SubscriptionState.UNKNOWN
            assert verdict.evidence.get("reason")


class TestVerdictShape(IsolatedAsyncioTestCase):
    async def test_source_is_always_twitch_helix(self):
        for harness in (
            _Harness(payload=_sub("1000")),
            _Harness(payload={"data": []}),
            _Harness(error=HelixUnavailable("boom")),
        ):
            verdict = await _resolve(harness)
            assert verdict.source == SubscriptionSource.TWITCH_HELIX

    async def test_checked_at_is_timezone_aware(self):
        verdict = await _resolve(_Harness(payload=_sub("1000")))
        assert verdict.checked_at.tzinfo is not None

    async def test_expires_at_is_in_the_future(self):
        verdict = await _resolve(_Harness(payload=_sub("1000")))
        assert verdict.expires_at is not None
        assert verdict.expires_at > verdict.checked_at
