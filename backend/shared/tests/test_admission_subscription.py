"""The subscription requirement's translation into the admission vocabulary.

Two claims, and neither of them is about Kleene composition -- that lives in
``shared/services/subscriptions`` and is covered by
``test_subscription_requirement.py``. What is covered here is the translation
this module owns, and every case where a naive translation loses information:

**Reasons survive.** A provider that is not ``active`` contributes a reason
carrying its own provider key as ``subject``, so ``mode="any"`` over two
unresolved providers yields two reasons rather than one arbitrary winner. A
verdict that forgot its ``evidence["reason"]`` still surfaces -- as
``"unknown"``/``system`` -- because a silently dropped provider bug reads to the
organizer exactly like "no problem here".

**Only ``refused`` blocks.** ``None`` (never asked), ``undetermined``, and any
outcome string this layer does not recognise all fail open. The cost of getting
that backwards is refusing a paying subscriber during a live check-in, so the
unrecognised-value case gets its own named test rather than riding along in a
parametrize list.
"""

from __future__ import annotations

import sys
from datetime import UTC, datetime
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from shared.services.admission import (  # noqa: E402
    AdmissionConfig,
    AdmissionSignals,
    AdmissionStage,
    ReasonActor,
    RequirementState,
    SubscriptionSignal,
)
from shared.services.admission.requirements.subscription import (  # noqa: E402
    KEY,
    build_subscription_signal,
    eval_subscription,
)
from shared.services.subscriptions import Outcome, SubscriptionVerdict  # noqa: E402

#: The exact public key set of the per-provider projection.
#:
#: This literal was written to hold two implementations together --
#: ``build_subscription_signal`` here and ``serialize_verdicts`` in
#: tournament-service -- while ``shared`` could not import a service. Ф3 deleted
#: the second one, so it no longer pins anything against a twin. It stays for the
#: other reason, which was always the more important one: ``evidence`` carries
#: guild ids and role ids, and this set is the allow-list that keeps them
#: internal. A field added to the projection must be added here deliberately, not
#: leak because a provider started attaching it.
SERIALIZED_KEYS = {"state", "tier_rank", "tier_label", "reason"}

CONFIG = AdmissionConfig(require_subscription=True)
STAGE = AdmissionStage.check_in


def _verdict(state: str, *, reason_code: str | None = None, tier: int | None = None, **evidence) -> SubscriptionVerdict:
    return SubscriptionVerdict(
        state=state,  # type: ignore[arg-type]
        tier_rank=tier,
        tier_label=f"Tier {tier}" if tier else None,
        source="test",
        checked_at=datetime(2026, 9, 2, tzinfo=UTC),
        expires_at=None,
        evidence={**evidence, **({"reason": reason_code} if reason_code else {})},
    )


def _signals(subscription: SubscriptionSignal | None) -> AdmissionSignals:
    return AdmissionSignals(
        registration_id=1,
        status="approved",
        balancer_status="ready",
        checked_in=False,
        subscription=subscription,
    )


class TestBuildSignalReasons:
    def test_active_verdict_contributes_no_reason(self):
        """A satisfied provider is not a reason, even when it carries a code."""
        signal = build_subscription_signal(
            Outcome.SATISFIED,
            {"discord": _verdict("active", tier=2, reason_code="role_matched")},
        )
        assert signal.reasons == ()

    def test_inactive_verdict_contributes_one_reason(self):
        signal = build_subscription_signal(
            Outcome.REFUSED, {"discord": _verdict("inactive", reason_code="not_subscribed")}
        )
        assert [(r.code, r.actor, r.subject) for r in signal.reasons] == [
            ("not_subscribed", ReasonActor.player, "discord")
        ]

    def test_unknown_verdict_contributes_one_reason(self):
        signal = build_subscription_signal(
            Outcome.UNDETERMINED,
            {"twitch": _verdict("unknown", reason_code="provider_unavailable")},
        )
        assert [(r.code, r.actor, r.subject) for r in signal.reasons] == [
            ("provider_unavailable", ReasonActor.system, "twitch")
        ]

    def test_missing_reason_still_surfaces(self):
        """A verdict without ``evidence["reason"]`` is a provider bug, not silence."""
        signal = build_subscription_signal(Outcome.UNDETERMINED, {"twitch": _verdict("unknown")})
        assert [(r.code, r.actor, r.subject) for r in signal.reasons] == [("unknown", ReasonActor.system, "twitch")]

    def test_every_unresolved_provider_gets_a_reason(self):
        """``mode="any"``: keeping one provider's reason would hide half the answer."""
        signal = build_subscription_signal(
            Outcome.UNDETERMINED,
            {
                "twitch": _verdict("unknown", reason_code="no_linked_twitch_account"),
                "discord": _verdict("inactive", reason_code="not_a_member"),
            },
        )
        assert [r.subject for r in signal.reasons] == ["discord", "twitch"]

    def test_reason_order_is_deterministic(self):
        """Sorted by provider, not by dict insertion: an organizer reloads the page."""
        verdicts = {
            "twitch": _verdict("inactive", reason_code="not_subscribed"),
            "boosty": _verdict("inactive", reason_code="not_subscribed"),
            "discord": _verdict("inactive", reason_code="not_a_member"),
        }
        forward = build_subscription_signal(Outcome.REFUSED, verdicts)
        reversed_insertion = build_subscription_signal(Outcome.REFUSED, dict(reversed(list(verdicts.items()))))
        assert [r.subject for r in forward.reasons] == ["boosty", "discord", "twitch"]
        assert forward.reasons == reversed_insertion.reasons


class TestBuildSignalProviders:
    def test_providers_match_serialize_verdicts_shape(self):
        signal = build_subscription_signal(
            Outcome.SATISFIED,
            {"discord": _verdict("active", tier=2, reason_code="role_matched")},
        )
        assert signal.providers == {
            "discord": {"state": "active", "tier_rank": 2, "tier_label": "Tier 2", "reason": "role_matched"}
        }
        assert set(signal.providers["discord"]) == SERIALIZED_KEYS

    def test_providers_leak_no_internal_evidence(self):
        """``evidence`` holds guild and role ids. Only ``reason`` is public."""
        signal = build_subscription_signal(
            Outcome.REFUSED,
            {"discord": _verdict("inactive", reason_code="not_a_member", guild_id=42, role_id=7, matched_role="vip")},
        )
        assert set(signal.providers["discord"]) == SERIALIZED_KEYS
        assert "guild_id" not in signal.providers["discord"]
        assert "role_id" not in signal.providers["discord"]

    def test_providers_keep_every_provider_including_active_ones(self):
        """The row chips render one chip per provider, satisfied ones included."""
        signal = build_subscription_signal(
            Outcome.SATISFIED,
            {"discord": _verdict("active", tier=1), "twitch": _verdict("unknown", reason_code="cache_not_ready")},
        )
        assert set(signal.providers) == {"discord", "twitch"}


class TestEvalSubscription:
    def test_satisfied(self):
        signal = build_subscription_signal(Outcome.SATISFIED, {"discord": _verdict("active", tier=1)})
        verdict = eval_subscription(CONFIG, _signals(signal), STAGE)
        assert (verdict.key, verdict.state, verdict.stage) == (KEY, RequirementState.satisfied, STAGE)

    def test_satisfied_emits_no_reasons(self):
        """A satisfied requirement has nothing to explain, whatever the signal carries."""
        signal = SubscriptionSignal(
            outcome=Outcome.SATISFIED.value,
            reasons=(build_subscription_signal(Outcome.REFUSED, {"x": _verdict("inactive")}).reasons[0],),
        )
        assert eval_subscription(CONFIG, _signals(signal), STAGE).reasons == ()

    def test_refused_blocks(self):
        signal = build_subscription_signal(
            Outcome.REFUSED, {"discord": _verdict("inactive", reason_code="not_subscribed")}
        )
        verdict = eval_subscription(CONFIG, _signals(signal), STAGE)
        assert verdict.state is RequirementState.blocked
        assert verdict.blocks
        assert [r.code for r in verdict.reasons] == ["not_subscribed"]

    def test_undetermined_does_not_block(self):
        signal = build_subscription_signal(
            Outcome.UNDETERMINED,
            {"discord": _verdict("unknown", reason_code="bot_not_configured")},
        )
        verdict = eval_subscription(CONFIG, _signals(signal), STAGE)
        assert verdict.state is RequirementState.undetermined
        assert not verdict.blocks
        assert [r.code for r in verdict.reasons] == ["bot_not_configured"]

    def test_missing_signal_is_undetermined_not_refused(self):
        """``None`` means "never asked" -- never "not subscribed"."""
        verdict = eval_subscription(CONFIG, _signals(None), STAGE)
        assert verdict.state is RequirementState.undetermined
        assert verdict.reasons == ()
        assert verdict.detail == {}

    def test_unrecognised_outcome_fails_open(self):
        """A future ``Outcome`` member must not lock anybody out of a live check-in."""
        verdict = eval_subscription(CONFIG, _signals(SubscriptionSignal(outcome="probationary")), STAGE)
        assert verdict.state is RequirementState.undetermined
        assert not verdict.blocks

    def test_detail_carries_outcome_and_providers(self):
        signal = build_subscription_signal(
            Outcome.REFUSED, {"discord": _verdict("inactive", reason_code="not_a_member")}
        )
        verdict = eval_subscription(CONFIG, _signals(signal), STAGE)
        assert verdict.detail == {"outcome": "refused", "providers": signal.providers}

    def test_stage_is_the_argument_not_the_config(self):
        """The registry resolved the stage; reading the column twice starts a second truth."""
        config = AdmissionConfig(require_subscription=True, subscription_stage=AdmissionStage.check_in)
        signal = build_subscription_signal(Outcome.REFUSED, {"discord": _verdict("inactive")})
        verdict = eval_subscription(config, _signals(signal), AdmissionStage.registration)
        assert verdict.stage is AdmissionStage.registration


class TestActorRouting:
    """Spot-checks through the real map: the actor split is the point of the taxonomy."""

    def test_organizer_reason(self):
        signal = build_subscription_signal(
            Outcome.UNDETERMINED,
            {"discord": _verdict("unknown", reason_code="role_mapping_drift")},
        )
        assert signal.reasons[0].actor is ReasonActor.organizer

    def test_player_reason(self):
        signal = build_subscription_signal(
            Outcome.UNDETERMINED,
            {"discord": _verdict("unknown", reason_code="no_linked_discord_account")},
        )
        assert signal.reasons[0].actor is ReasonActor.player

    def test_system_reason(self):
        """A missing ``DISCORD_TOKEN`` is nobody in the product's fault to fix."""
        signal = build_subscription_signal(
            Outcome.UNDETERMINED,
            {"discord": _verdict("unknown", reason_code="bot_not_configured")},
        )
        assert signal.reasons[0].actor is ReasonActor.system
