"""Subscription requirement on the registration form.

Pure schema/serializer coverage: the round-trip from an API payload to the model
columns and back. The columns mirror ``require_open_profile``, so every layer that
flag touches must carry these too — a missing layer silently drops the rule.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest


def _ensure_test_env() -> None:
    env = {
        "POSTGRES_HOST": "localhost",
        "POSTGRES_PORT": "5432",
        "POSTGRES_DB": "tournament_test",
        "POSTGRES_USER": "postgres",
        "POSTGRES_PASSWORD": "postgres",
        "JWT_SECRET_KEY": "test-secret",
    }
    for key, value in env.items():
        os.environ.setdefault(key, value)


_ensure_test_env()

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from shared.subscriptions import Outcome, parse_requirement  # noqa: E402
from src.schemas.registration import (  # noqa: E402
    RegistrationFormRead,
    RegistrationFormUpsert,
)
from src.services.registration.serializers import serialize_registration_form  # noqa: E402

ANY_BOOSTY_OR_TWITCH = {
    "mode": "any",
    "requirements": [
        {"provider": "boosty", "min_tier_rank": 2},
        {"provider": "twitch", "min_tier_rank": 1},
    ],
}


class _FormRow:
    """Stand-in for models.BalancerRegistrationForm (serializer reads attributes)."""

    def __init__(self, **overrides):
        self.id = 1
        self.tournament_id = 10
        self.workspace_id = 7
        self.is_open = True
        self.auto_approve = False
        self.require_open_profile = False
        self.open_profile_scope = "main"
        self.show_ranks = False
        self.built_in_fields_json = {}
        self.custom_fields_json = []
        self.require_subscription = False
        self.subscription_requirement_json = {}
        for key, value in overrides.items():
            setattr(self, key, value)


class TestUpsertSchema:
    def test_defaults_are_off(self):
        """A tournament that never configures this must not start enforcing."""
        body = RegistrationFormUpsert()
        assert body.require_subscription is False
        assert body.subscription_requirement_json == {}

    def test_accepts_a_requirement_blob(self):
        body = RegistrationFormUpsert(
            require_subscription=True,
            subscription_requirement_json=ANY_BOOSTY_OR_TWITCH,
        )
        assert body.require_subscription is True
        assert body.subscription_requirement_json["mode"] == "any"

    def test_rejects_an_unknown_mode_at_the_api_boundary(self):
        """Better a 422 on save than a surprise at check-in time."""
        with pytest.raises(ValueError, match="mode"):
            RegistrationFormUpsert(
                require_subscription=True,
                subscription_requirement_json={"mode": "most", "requirements": []},
            )

    def test_rejects_a_requirement_without_a_provider(self):
        with pytest.raises(ValueError):
            RegistrationFormUpsert(
                require_subscription=True,
                subscription_requirement_json={"requirements": [{"min_tier_rank": 2}]},
            )

    def test_allows_the_toggle_on_with_an_empty_requirement(self):
        """Turning the master switch on before picking providers is a legitimate
        intermediate state in the admin UI; the gate treats it as no-op."""
        body = RegistrationFormUpsert(require_subscription=True, subscription_requirement_json={})
        assert parse_requirement(body.subscription_requirement_json).requirements == ()

    def test_clamps_min_tier_rank_below_one(self):
        body = RegistrationFormUpsert(
            subscription_requirement_json={"requirements": [{"provider": "boosty", "min_tier_rank": 0}]}
        )
        requirement = parse_requirement(body.subscription_requirement_json)
        assert requirement.requirements[0].min_tier_rank == 1

    def test_deduplicates_a_provider_keeping_the_strictest_threshold(self):
        body = RegistrationFormUpsert(
            subscription_requirement_json={
                "requirements": [
                    {"provider": "boosty", "min_tier_rank": 1},
                    {"provider": "boosty", "min_tier_rank": 3},
                ]
            }
        )
        requirement = parse_requirement(body.subscription_requirement_json)
        assert [r.min_tier_rank for r in requirement.requirements] == [3]


class TestReadSchema:
    def test_defaults_are_off(self):
        form = RegistrationFormRead(id=1, tournament_id=1, workspace_id=1, is_open=False)
        assert form.require_subscription is False
        assert form.subscription_requirement_json == {}


class TestSerializer:
    def test_carries_the_toggle_and_the_blob(self):
        read = serialize_registration_form(
            _FormRow(
                require_subscription=True,
                subscription_requirement_json=ANY_BOOSTY_OR_TWITCH,
            )
        )
        assert read.require_subscription is True
        assert read.subscription_requirement_json == ANY_BOOSTY_OR_TWITCH

    def test_null_blob_serializes_as_an_empty_object(self):
        """The column is JSON and could be NULL on a legacy row."""
        read = serialize_registration_form(_FormRow(subscription_requirement_json=None))
        assert read.subscription_requirement_json == {}

    def test_untouched_form_serializes_as_disabled(self):
        read = serialize_registration_form(_FormRow())
        assert read.require_subscription is False


class TestRoundTrip:
    def test_upsert_blob_survives_into_a_usable_requirement(self):
        """The whole point: what the organizer saved is what the gate evaluates."""
        body = RegistrationFormUpsert(require_subscription=True, subscription_requirement_json=ANY_BOOSTY_OR_TWITCH)
        read = serialize_registration_form(
            _FormRow(
                require_subscription=body.require_subscription,
                subscription_requirement_json=body.subscription_requirement_json,
            )
        )
        requirement = parse_requirement(read.subscription_requirement_json)
        assert requirement.mode == "any"
        assert {r.provider: r.min_tier_rank for r in requirement.requirements} == {
            "boosty": 2,
            "twitch": 1,
        }

    def test_single_provider_requirement_is_mode_agnostic(self):
        one = {"requirements": [{"provider": "boosty", "min_tier_rank": 2}]}
        from shared.subscriptions import SubscriptionVerdict

        def _v(state, tier):
            from datetime import UTC, datetime

            return SubscriptionVerdict(
                state=state,
                tier_rank=tier,
                tier_label=None,
                source="test",
                checked_at=datetime.now(UTC),
                expires_at=None,
            )

        from shared.subscriptions import evaluate_requirement

        for mode in ("any", "all"):
            requirement = parse_requirement({**one, "mode": mode})
            assert evaluate_requirement(requirement, {"boosty": _v("active", 2)}) is Outcome.SATISFIED
