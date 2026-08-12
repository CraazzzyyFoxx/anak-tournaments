import dataclasses
from datetime import UTC, datetime

import pytest

from shared.subscriptions import (
    SubscriptionState,
    SubscriptionVerdict,
    meets_min_tier,
    normalize_twitch_tier,
)


def _verdict(state: str, tier: int | None) -> SubscriptionVerdict:
    return SubscriptionVerdict(
        state=state,
        tier_rank=tier,
        tier_label=None,
        source="test",
        checked_at=datetime.now(UTC),
        expires_at=None,
    )


class TestMeetsMinTier:
    def test_active_at_or_above_min_passes(self):
        assert meets_min_tier(_verdict("active", 2), min_tier_rank=2) is True
        assert meets_min_tier(_verdict("active", 3), min_tier_rank=2) is True

    def test_active_below_min_fails(self):
        assert meets_min_tier(_verdict("active", 1), min_tier_rank=2) is False

    def test_inactive_fails_regardless_of_tier(self):
        assert meets_min_tier(_verdict("inactive", 5), min_tier_rank=1) is False

    def test_unknown_fails_open(self):
        """A provider outage must never block admission — mirrors resolve_profiles_open."""
        assert meets_min_tier(_verdict("unknown", None), min_tier_rank=3) is True

    def test_active_without_tier_satisfies_min_of_one(self):
        """Providers that prove a subscription but not its level (challenge code at
        the base level) report tier_rank=None; that is 'subscribed at level >= 1'."""
        assert meets_min_tier(_verdict("active", None), min_tier_rank=1) is True
        assert meets_min_tier(_verdict("active", None), min_tier_rank=2) is False


class TestNormalizeTwitchTier:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [("1000", 1), ("2000", 2), ("3000", 3)],
    )
    def test_maps_documented_tiers(self, raw, expected):
        assert normalize_twitch_tier(raw) == expected

    def test_unknown_tier_string_is_none(self):
        assert normalize_twitch_tier("9999") is None
        assert normalize_twitch_tier("") is None
        assert normalize_twitch_tier(None) is None


class TestSubscriptionVerdict:
    def test_is_frozen(self):
        v = _verdict("active", 1)
        with pytest.raises(dataclasses.FrozenInstanceError):
            v.state = "inactive"  # type: ignore[misc]

    def test_state_constants_match_literal(self):
        assert SubscriptionState.ACTIVE == "active"
        assert SubscriptionState.INACTIVE == "inactive"
        assert SubscriptionState.UNKNOWN == "unknown"
