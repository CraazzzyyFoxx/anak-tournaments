"""Workspace-level subscription provider configuration.

Minimal admin surface: raw ids typed by hand (guild id, role ids, broadcaster id).
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

import os
import sys
from pathlib import Path
from unittest import IsolatedAsyncioTestCase


def _ensure_test_env() -> None:
    for key, value in {
        "POSTGRES_HOST": "localhost",
        "POSTGRES_PORT": "5432",
        "POSTGRES_DB": "tournament_test",
        "POSTGRES_USER": "postgres",
        "POSTGRES_PASSWORD": "postgres",
        "JWT_SECRET_KEY": "test-secret",
        "REDIS_URL": "redis://localhost:6379",
    }.items():
        os.environ.setdefault(key, value)


_ensure_test_env()

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from shared.core.errors import BaseAPIException as HTTPException  # noqa: E402
from shared.subscriptions.challenge_code import hash_code  # noqa: E402
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
    def test_stores_guild_id_and_role_tiers(self):
        body = SubscriptionProviderConfigUpsert(
            provider="boosty",
            guild_id="999",
            role_tiers=[{"role_id": "100", "tier_rank": 2, "tier_label": "Уровень 2"}],
        )
        config = build_config_json(body, existing={})
        assert config["guild_id"] == "999"
        assert config["role_tiers"] == [{"role_id": "100", "tier_rank": 2, "tier_label": "Уровень 2"}]

    def test_keeps_snowflakes_as_strings(self):
        """Discord ids exceed 2**53 and must never round-trip through a float."""
        big = "1234567890123456789"
        body = SubscriptionProviderConfigUpsert(
            provider="boosty", guild_id=big, role_tiers=[{"role_id": big, "tier_rank": 1}]
        )
        config = build_config_json(body, existing={})
        assert config["guild_id"] == big
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
        body = SubscriptionProviderConfigUpsert(provider="boosty", guild_id="999")
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

    def test_omitting_guild_id_keeps_the_stored_one(self):
        existing = {"guild_id": "999"}
        body = SubscriptionProviderConfigUpsert(provider="boosty", role_tiers=[])
        assert build_config_json(body, existing=existing)["guild_id"] == "999"

    def test_an_explicit_empty_guild_id_clears_it(self):
        existing = {"guild_id": "999"}
        body = SubscriptionProviderConfigUpsert(provider="boosty", guild_id="")
        assert build_config_json(body, existing=existing).get("guild_id") in (None, "")


class TestSerializeProviderConfig:
    def test_never_returns_a_code_digest(self):
        """A digest is still a secret-equivalent for brute force; the UI only needs
        to know how many codes exist and at what tier."""
        row = _Row(config={"codes": [{"code_sha256": "a" * 64, "tier_rank": 2, "tier_label": "L2"}]})
        read = serialize_provider_config(row)
        assert "a" * 64 not in str(read.model_dump())
        assert read.codes[0].tier_rank == 2
        assert read.codes[0].tier_label == "L2"

    def test_exposes_guild_and_role_tiers(self):
        row = _Row(
            config={
                "guild_id": "999",
                "role_tiers": [{"role_id": "100", "tier_rank": 1, "tier_label": "L1"}],
            }
        )
        read = serialize_provider_config(row)
        assert read.guild_id == "999"
        assert read.role_tiers[0].role_id == "100"

    def test_reports_the_enabled_flag(self):
        assert serialize_provider_config(_Row(enabled=False)).enabled is False

    def test_tolerates_an_empty_config(self):
        read = serialize_provider_config(_Row(config={}))
        assert read.guild_id is None
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
        body = SubscriptionProviderConfigUpsert(provider="boosty", guild_id="1")
        assert build_config_json(body, existing={"verification_method": "code"})["verification_method"] == "code"

    def test_an_explicit_method_replaces_the_stored_one(self):
        body = SubscriptionProviderConfigUpsert(provider="boosty", verification_method="live")
        assert build_config_json(body, existing={"verification_method": "code"})["verification_method"] == "live"

    def test_every_known_method_is_accepted(self):
        for method in ("live", "code", "any"):
            assert SubscriptionProviderConfigUpsert(provider="boosty", verification_method=method)
