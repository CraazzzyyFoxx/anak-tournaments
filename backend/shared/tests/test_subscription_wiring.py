"""The wiring builds and registers the providers the design promises.

Cheap guard against a broken import or a renamed provider key: the resolver reads
``provider_config.provider`` values straight out of the database, so a mismatch
between those strings and the strategy registry keys silently degrades every
verdict to ``no_strategy_for_provider`` (unknown, fail-open) — the gate stops
enforcing and nothing errors.
"""

from __future__ import annotations

from shared.core.social import SocialProvider
from shared.services.subscription_entitlements import SubscriptionResolver
from shared.services.subscription_wiring import build_resolver, build_strategies


class TestBuildStrategies:
    def test_registers_boosty_and_twitch(self):
        strategies = build_strategies(None)  # type: ignore[arg-type]
        assert set(strategies) == {SocialProvider.BOOSTY, SocialProvider.TWITCH}

    def test_keys_are_the_canonical_social_provider_strings(self):
        """These strings are stored in the DB; they must not drift."""
        strategies = build_strategies(None)  # type: ignore[arg-type]
        assert set(strategies) == {"boosty", "twitch"}

    def test_strategies_expose_resolve_many(self):
        for strategy in build_strategies(None).values():  # type: ignore[arg-type]
            assert callable(getattr(strategy, "resolve_many", None))

    def test_builds_without_credentials(self):
        """Missing credentials must not raise at construction: the resolver has to
        be buildable so it can report a reasoned `unknown` per user."""
        assert build_strategies(None, discord_bot_token=None, twitch_client_id=None)  # type: ignore[arg-type]


class TestBuildResolver:
    def test_returns_a_resolver(self):
        assert isinstance(build_resolver(None), SubscriptionResolver)  # type: ignore[arg-type]

    def test_passes_credentials_through(self):
        resolver = build_resolver(
            None,  # type: ignore[arg-type]
            discord_bot_token="bot-token",
            twitch_client_id="client-id",
        )
        assert isinstance(resolver, SubscriptionResolver)
