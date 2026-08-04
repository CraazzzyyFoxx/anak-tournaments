from datetime import UTC, datetime

import pytest

from shared.subscriptions import SubscriptionVerdict
from shared.subscriptions.requirement import (
    Outcome,
    ProviderRequirement,
    SubscriptionRequirement,
    evaluate_requirement,
    parse_requirement,
)


def _v(state: str, tier: int | None = None) -> SubscriptionVerdict:
    return SubscriptionVerdict(
        state=state,
        tier_rank=tier,
        tier_label=None,
        source="test",
        checked_at=datetime.now(UTC),
        expires_at=None,
    )


T = _v("active", 3)  # satisfies min_tier_rank <= 3
F = _v("inactive")  # confirmed refusal
U = _v("unknown")  # undetermined


def _req(mode: str, *providers: str, min_tier: int = 1) -> SubscriptionRequirement:
    return SubscriptionRequirement(
        mode=mode,  # type: ignore[arg-type]
        requirements=tuple(ProviderRequirement(provider=p, min_tier_rank=min_tier) for p in providers),
    )


class TestSingleProvider:
    """One requirement: both modes must agree — no special-casing in the code."""

    @pytest.mark.parametrize("mode", ["any", "all"])
    def test_satisfied(self, mode):
        assert evaluate_requirement(_req(mode, "boosty"), {"boosty": T}) is Outcome.SATISFIED

    @pytest.mark.parametrize("mode", ["any", "all"])
    def test_refused(self, mode):
        assert evaluate_requirement(_req(mode, "boosty"), {"boosty": F}) is Outcome.REFUSED

    @pytest.mark.parametrize("mode", ["any", "all"])
    def test_undetermined(self, mode):
        assert evaluate_requirement(_req(mode, "boosty"), {"boosty": U}) is Outcome.UNDETERMINED


class TestAllMode:
    def test_all_satisfied(self):
        assert evaluate_requirement(_req("all", "boosty", "twitch"), {"boosty": T, "twitch": T}) is Outcome.SATISFIED

    def test_any_refusal_refuses(self):
        assert evaluate_requirement(_req("all", "boosty", "twitch"), {"boosty": T, "twitch": F}) is Outcome.REFUSED

    def test_refusal_beats_undetermined(self):
        """F dominates in `all` — certainty of failure outranks uncertainty."""
        assert evaluate_requirement(_req("all", "boosty", "twitch"), {"boosty": F, "twitch": U}) is Outcome.REFUSED

    def test_undetermined_without_refusal_is_undetermined(self):
        """A Boosty outage must not block a patron who is verified on Twitch."""
        assert evaluate_requirement(_req("all", "boosty", "twitch"), {"boosty": U, "twitch": T}) is Outcome.UNDETERMINED


class TestAnyMode:
    def test_one_satisfied_is_enough(self):
        assert evaluate_requirement(_req("any", "boosty", "twitch"), {"boosty": F, "twitch": T}) is Outcome.SATISFIED

    def test_satisfied_beats_undetermined(self):
        assert evaluate_requirement(_req("any", "boosty", "twitch"), {"boosty": U, "twitch": T}) is Outcome.SATISFIED

    def test_all_refused_refuses(self):
        assert evaluate_requirement(_req("any", "boosty", "twitch"), {"boosty": F, "twitch": F}) is Outcome.REFUSED

    def test_undetermined_rescues_a_refusal(self):
        """THE regression this task exists to prevent: coercing U to False here would
        block every Boosty-less patron whenever Twitch is down."""
        assert evaluate_requirement(_req("any", "boosty", "twitch"), {"boosty": F, "twitch": U}) is Outcome.UNDETERMINED

    def test_all_undetermined_is_undetermined(self):
        assert evaluate_requirement(_req("any", "boosty", "twitch"), {"boosty": U, "twitch": U}) is Outcome.UNDETERMINED


class TestOrderIndependence:
    """Composition must be commutative — provider order in config is arbitrary."""

    @pytest.mark.parametrize("mode", ["any", "all"])
    @pytest.mark.parametrize(
        ("a", "b"),
        [(T, F), (T, U), (F, U), (T, T), (F, F), (U, U)],
    )
    def test_swapping_two_providers_keeps_the_outcome(self, mode, a, b):
        req = _req(mode, "boosty", "twitch")
        forward = evaluate_requirement(req, {"boosty": a, "twitch": b})
        backward = evaluate_requirement(req, {"boosty": b, "twitch": a})
        assert forward is backward


class TestThresholds:
    def test_tier_below_threshold_is_a_refusal_not_undetermined(self):
        req = _req("all", "boosty", min_tier=3)
        assert evaluate_requirement(req, {"boosty": _v("active", 1)}) is Outcome.REFUSED

    def test_per_provider_thresholds_are_independent(self):
        """Boosty 'Уровень 2' and Twitch 'Tier 2' are unrelated scales."""
        req = SubscriptionRequirement(
            mode="all",
            requirements=(
                ProviderRequirement(provider="boosty", min_tier_rank=3),
                ProviderRequirement(provider="twitch", min_tier_rank=1),
            ),
        )
        verdicts = {"boosty": _v("active", 3), "twitch": _v("active", 1)}
        assert evaluate_requirement(req, verdicts) is Outcome.SATISFIED

    def test_active_without_tier_meets_min_of_one(self):
        assert (
            evaluate_requirement(_req("all", "boosty", min_tier=1), {"boosty": _v("active", None)}) is Outcome.SATISFIED
        )


class TestMissingVerdicts:
    def test_absent_provider_is_undetermined_not_refused(self):
        """An unconfigured/disabled provider is the organizer's problem, not the
        patron's — it must never read as 'not subscribed'."""
        assert evaluate_requirement(_req("all", "boosty", "twitch"), {"boosty": T}) is Outcome.UNDETERMINED

    def test_absent_provider_in_any_mode_does_not_refuse(self):
        assert evaluate_requirement(_req("any", "boosty", "twitch"), {"boosty": F}) is Outcome.UNDETERMINED

    def test_empty_requirement_list_is_satisfied(self):
        """Nothing required means nothing to block on."""
        assert evaluate_requirement(_req("all"), {}) is Outcome.SATISFIED
        assert evaluate_requirement(_req("any"), {}) is Outcome.SATISFIED


class TestBlocksAdmission:
    """Both gates' only question. Blocks IFF the outcome is REFUSED."""

    def test_only_refused_blocks(self):
        assert Outcome.REFUSED.blocks_admission is True
        assert Outcome.UNDETERMINED.blocks_admission is False
        assert Outcome.SATISFIED.blocks_admission is False


class TestDeferredProviders:
    """Registration submit runs before the patron is offered the phrase field.

    A provider they can still satisfy by pasting a code is therefore not yet
    decided, and folds in as UNDETERMINED so the existing Kleene table does the
    rest — no second composition path, no mode special-casing.
    """

    def test_a_deferred_refusal_becomes_undetermined(self):
        assert (
            evaluate_requirement(_req("all", "boosty"), {"boosty": F}, deferred_providers={"boosty"})
            is Outcome.UNDETERMINED
        )

    def test_deferral_never_hides_a_satisfied_verdict(self):
        assert (
            evaluate_requirement(_req("all", "boosty"), {"boosty": T}, deferred_providers={"boosty"})
            is Outcome.SATISFIED
        )

    def test_a_tier_shortfall_is_deferred_too(self):
        """A higher-tier code can still lift an active-but-too-low patron."""
        assert (
            evaluate_requirement(
                _req("all", "boosty", min_tier=3), {"boosty": _v("active", 1)}, deferred_providers={"boosty"}
            )
            is Outcome.UNDETERMINED
        )

    def test_a_provider_outside_the_set_still_refuses(self):
        """Deferral is per provider: Twitch has an API, so its no is final."""
        assert (
            evaluate_requirement(
                _req("all", "boosty", "twitch"), {"boosty": F, "twitch": F}, deferred_providers={"boosty"}
            )
            is Outcome.REFUSED
        )

    def test_all_mode_still_blocks_on_an_independent_refusal(self):
        """`all` needs every provider, so a code cannot rescue a Twitch refusal."""
        assert (
            evaluate_requirement(
                _req("all", "boosty", "twitch"), {"boosty": T, "twitch": F}, deferred_providers={"boosty"}
            )
            is Outcome.REFUSED
        )

    def test_any_mode_defers_the_whole_rule(self):
        """Under `any` the code alone would admit them — refusing now would be wrong."""
        assert (
            evaluate_requirement(
                _req("any", "boosty", "twitch"), {"boosty": F, "twitch": F}, deferred_providers={"boosty"}
            )
            is Outcome.UNDETERMINED
        )

    def test_empty_set_is_the_check_in_behaviour(self):
        assert evaluate_requirement(_req("all", "boosty"), {"boosty": F}, deferred_providers=set()) is Outcome.REFUSED

    def test_naming_a_provider_the_rule_ignores_changes_nothing(self):
        assert (
            evaluate_requirement(_req("all", "boosty"), {"boosty": F}, deferred_providers={"twitch"})
            is Outcome.REFUSED
        )


class TestParseRequirement:
    def test_reads_mode_and_requirements(self):
        req = parse_requirement({"mode": "any", "requirements": [{"provider": "boosty", "min_tier_rank": 2}]})
        assert req.mode == "any"
        assert req.requirements == (ProviderRequirement(provider="boosty", min_tier_rank=2),)

    def test_defaults_mode_to_all(self):
        assert parse_requirement({"requirements": []}).mode == "all"

    def test_rejects_unknown_mode(self):
        with pytest.raises(ValueError, match="mode"):
            parse_requirement({"mode": "most", "requirements": []})

    def test_defaults_min_tier_rank_to_one(self):
        req = parse_requirement({"requirements": [{"provider": "boosty"}]})
        assert req.requirements[0].min_tier_rank == 1

    def test_clamps_min_tier_rank_below_one(self):
        req = parse_requirement({"requirements": [{"provider": "boosty", "min_tier_rank": 0}]})
        assert req.requirements[0].min_tier_rank == 1

    def test_unparseable_min_tier_rank_defaults_to_one(self):
        req = parse_requirement({"requirements": [{"provider": "boosty", "min_tier_rank": "x"}]})
        assert req.requirements[0].min_tier_rank == 1

    def test_skips_rows_without_provider(self):
        assert parse_requirement({"requirements": [{"min_tier_rank": 2}]}).requirements == ()

    def test_deduplicates_provider_keeping_strictest_threshold(self):
        req = parse_requirement(
            {
                "requirements": [
                    {"provider": "boosty", "min_tier_rank": 1},
                    {"provider": "boosty", "min_tier_rank": 3},
                ]
            }
        )
        assert req.requirements == (ProviderRequirement(provider="boosty", min_tier_rank=3),)

    def test_providers_property_lists_distinct_providers(self):
        req = parse_requirement({"requirements": [{"provider": "boosty"}, {"provider": "twitch"}]})
        assert set(req.providers) == {"boosty", "twitch"}

    def test_empty_blob_yields_empty_requirement(self):
        assert parse_requirement({}).requirements == ()
        assert parse_requirement(None).requirements == ()

    def test_round_trips_through_evaluate(self):
        """The parsed shape must be directly usable by the evaluator."""
        req = parse_requirement({"mode": "any", "requirements": [{"provider": "boosty", "min_tier_rank": 2}]})
        assert evaluate_requirement(req, {"boosty": _v("active", 2)}) is Outcome.SATISFIED
        assert evaluate_requirement(req, {"boosty": _v("active", 1)}) is Outcome.REFUSED
