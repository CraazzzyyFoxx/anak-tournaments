"""Workspace-level subscription provider configuration.

Minimal admin surface: raw ids typed by hand (role ids, broadcaster id). The Discord
guild id is NOT among them -- it belongs to the workspace, not to a provider blob.
No Discord API picker yet — that is the "more elegant" follow-up.

The rules that matter here:

- Challenge codes arrive as PLAINTEXT from the admin and are stored as SHA-256
  only. The plaintext is never persisted and never echoed back, so the read model
  returns a redacted view.
- An upsert must not silently drop the codes an admin cannot see. Omitting the
  ``codes`` field keeps the stored ones; passing an explicit list replaces them.

Runs under stdlib unittest -- no pytest-asyncio in this repo.
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest import IsolatedAsyncioTestCase

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from shared.core.errors import BaseAPIException as HTTPException  # noqa: E402
from shared.services.subscriptions.challenge_code import hash_code  # noqa: E402
from src.schemas.registration import SubscriptionProviderConfigUpsert  # noqa: E402
from src.services.registration.subscription_config import (  # noqa: E402
    build_config_json,
    serialize_provider_config,
)

WS = 7


class _Row:
    """Stand-in for models.SubscriptionProviderConfig."""

    def __init__(self, provider="boosty", enabled=True, config=None):
        self.id = 1
        self.workspace_id = WS
        self.provider = provider
        self.enabled = enabled
        self.config_json = config or {}


class TestUpsertSchema:
    def test_rejects_an_unknown_provider(self):
        try:
            SubscriptionProviderConfigUpsert(provider="patreon")
        except ValueError as exc:
            assert "provider" in str(exc)
        else:
            raise AssertionError("expected a validation error")

    def test_accepts_boosty_and_twitch(self):
        for provider in ("boosty", "twitch"):
            assert SubscriptionProviderConfigUpsert(provider=provider).provider == provider

    def test_defaults_to_disabled(self):
        """Creating a config must never start enforcing on its own."""
        assert SubscriptionProviderConfigUpsert(provider="boosty").enabled is False

    def test_role_tier_requires_a_role_id(self):
        try:
            SubscriptionProviderConfigUpsert(provider="boosty", role_tiers=[{"tier_rank": 1, "tier_label": "L1"}])
        except ValueError:
            pass
        else:
            raise AssertionError("expected a validation error")

    def test_rejects_tier_rank_below_one(self):
        """Deliberate asymmetry with `parse_requirement`, which CLAMPS instead.

        On write the admin gets an explicit error; when reading a stored blob at
        check-in time clamping is right, because a bad row must never 500 the gate.
        """
        try:
            SubscriptionProviderConfigUpsert(provider="boosty", role_tiers=[{"role_id": "1", "tier_rank": 0}])
        except ValueError:
            pass
        else:
            raise AssertionError("expected a validation error")


class TestBuildConfigJson:
    def test_stores_role_tiers(self):
        body = SubscriptionProviderConfigUpsert(
            provider="boosty",
            role_tiers=[{"role_id": "100", "tier_rank": 2, "tier_label": "Уровень 2"}],
        )
        config = build_config_json(body, existing={})
        assert config["role_tiers"] == [{"role_id": "100", "tier_rank": 2, "tier_label": "Уровень 2"}]

    def test_keeps_snowflakes_as_strings(self):
        """Discord ids exceed 2**53 and must never round-trip through a float."""
        big = "1234567890123456789"
        body = SubscriptionProviderConfigUpsert(provider="boosty", role_tiers=[{"role_id": big, "tier_rank": 1}])
        config = build_config_json(body, existing={})
        assert config["role_tiers"][0]["role_id"] == big

    def test_stores_broadcaster_for_twitch(self):
        body = SubscriptionProviderConfigUpsert(provider="twitch", broadcaster_id="12345", broadcaster_login="streamer")
        config = build_config_json(body, existing={})
        assert config["broadcaster_id"] == "12345"
        assert config["broadcaster_login"] == "streamer"

    def test_hashes_plaintext_codes(self):
        body = SubscriptionProviderConfigUpsert(provider="boosty", codes=[{"code": "secret", "tier_rank": 2}])
        config = build_config_json(body, existing={})
        stored = config["codes"][0]
        assert stored["code_sha256"] == hash_code("secret")
        assert "code" not in stored, "plaintext must never be persisted"
        assert "secret" not in str(config)

    def test_omitting_codes_keeps_the_stored_ones(self):
        """The admin cannot see existing codes, so a plain save must not wipe them."""
        existing = {"codes": [{"code_sha256": "a" * 64, "tier_rank": 1}]}
        body = SubscriptionProviderConfigUpsert(provider="boosty")
        config = build_config_json(body, existing=existing)
        assert config["codes"] == existing["codes"]

    def test_an_explicit_empty_list_clears_the_codes(self):
        existing = {"codes": [{"code_sha256": "a" * 64, "tier_rank": 1}]}
        body = SubscriptionProviderConfigUpsert(provider="boosty", codes=[])
        config = build_config_json(body, existing=existing)
        assert config["codes"] == []

    def test_a_code_row_may_carry_an_already_hashed_value(self):
        """Round-tripping the redacted read model must not double-hash."""
        digest = hash_code("secret")
        body = SubscriptionProviderConfigUpsert(provider="boosty", codes=[{"code_sha256": digest, "tier_rank": 3}])
        config = build_config_json(body, existing={})
        assert config["codes"][0]["code_sha256"] == digest

    def test_a_code_row_with_neither_plaintext_nor_digest_is_rejected(self):
        try:
            SubscriptionProviderConfigUpsert(provider="boosty", codes=[{"tier_rank": 1}])
        except ValueError:
            pass
        else:
            raise AssertionError("expected a validation error")

    def test_a_stale_client_guild_is_ignored_not_written(self):
        """The blob must never regain the key, whatever an old frontend posts."""
        body = SubscriptionProviderConfigUpsert.model_validate({"provider": "boosty", "guild_id": "999"})
        assert "guild_id" not in build_config_json(body, existing={})


class TestSerializeProviderConfig:
    def test_never_returns_a_code_digest(self):
        """A digest is still a secret-equivalent for brute force; the UI only needs
        to know how many codes exist and at what tier."""
        row = _Row(config={"codes": [{"code_sha256": "a" * 64, "tier_rank": 2, "tier_label": "L2"}]})
        read = serialize_provider_config(row)
        assert "a" * 64 not in str(read.model_dump())
        assert read.codes[0].tier_rank == 2
        assert read.codes[0].tier_label == "L2"

    def test_exposes_role_tiers(self):
        row = _Row(config={"role_tiers": [{"role_id": "100", "tier_rank": 1, "tier_label": "L1"}]})
        read = serialize_provider_config(row)
        assert read.role_tiers[0].role_id == "100"

    def test_a_stored_guild_is_not_echoed_back(self):
        row = _Row(config={"guild_id": "999", "role_tiers": [{"role_id": "1", "tier_rank": 1}]})
        read = serialize_provider_config(row)
        assert not hasattr(read, "guild_id")

    def test_reports_the_enabled_flag(self):
        assert serialize_provider_config(_Row(enabled=False)).enabled is False

    def test_tolerates_an_empty_config(self):
        read = serialize_provider_config(_Row(config={}))
        assert read.role_tiers == []
        assert read.codes == []


class TestDuplicateRoleGuard(IsolatedAsyncioTestCase):
    async def test_duplicate_role_id_is_rejected(self):
        """Two tiers on one role make the verdict depend on dict ordering."""
        with self.assertRaises((ValueError, HTTPException)):
            SubscriptionProviderConfigUpsert(
                provider="boosty",
                role_tiers=[
                    {"role_id": "100", "tier_rank": 1},
                    {"role_id": "100", "tier_rank": 2},
                ],
            )


class TestVerificationMethod:
    def test_defaults_to_any_so_existing_configs_are_unchanged(self):
        assert serialize_provider_config(_Row(config={})).verification_method == "any"

    def test_round_trips_a_stored_method(self):
        assert serialize_provider_config(_Row(config={"verification_method": "code"})).verification_method == "code"

    def test_a_stored_value_the_code_no_longer_knows_reads_back_as_any(self):
        """It must match what the gate does at runtime, which widens rather than
        locking a tournament out."""
        row = _Row(config={"verification_method": "discord_role"})
        assert serialize_provider_config(row).verification_method == "any"

    def test_upsert_rejects_an_unknown_method(self):
        """Asymmetric with the reader on purpose: a typo the admin can still fix is
        an error, a bad stored blob is not."""
        try:
            SubscriptionProviderConfigUpsert(provider="boosty", verification_method="discord_role")
        except ValueError as exc:
            assert "verification_method" in str(exc)
        else:
            raise AssertionError("expected a validation error")

    def test_omitting_the_method_keeps_the_stored_one(self):
        body = SubscriptionProviderConfigUpsert(provider="boosty")
        assert build_config_json(body, existing={"verification_method": "code"})["verification_method"] == "code"

    def test_an_explicit_method_replaces_the_stored_one(self):
        body = SubscriptionProviderConfigUpsert(provider="boosty", verification_method="live")
        assert build_config_json(body, existing={"verification_method": "code"})["verification_method"] == "live"

    def test_every_known_method_is_accepted(self):
        for method in ("live", "code", "any"):
            assert SubscriptionProviderConfigUpsert(provider="boosty", verification_method=method)
