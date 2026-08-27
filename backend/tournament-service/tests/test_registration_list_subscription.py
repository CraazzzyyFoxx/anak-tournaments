"""Subscription verdicts on registration reads.

Two things matter here and nothing else:

1. The list path resolves the WHOLE batch once, with ``force_refresh=False``.
   Fanning out per registration would serialize behind Discord's per-guild rate
   limit bucket and make a participants page with 200 rows unusable.
2. Both the composed outcome (drives the admin column and ``isAdmitted``) and the
   per-provider verdicts (drive the per-row chips) come from that single pass —
   resolving twice would double every provider call.

Runs under stdlib unittest -- no pytest-asyncio in this repo.
"""

from __future__ import annotations

import sys
from datetime import UTC, datetime
from pathlib import Path
from unittest import IsolatedAsyncioTestCase


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from shared.services.subscriptions import (  # noqa: E402
    Outcome,
    SubscriptionState,
    SubscriptionVerdict,
    evaluate_requirement,
)
from src.schemas.registration import RegistrationRead  # noqa: E402
from src.services.registration.subscription_reads import (  # noqa: E402
    build_subscription_reads,
    serialize_verdicts,
)

# The resolver's fail-open contract, defined once -- see that module's docstring.
from tests._subscription_fakes import resolver_rule as _rule  # noqa: E402

EITHER = {"mode": "any", "requirements": [{"provider": "boosty"}, {"provider": "twitch"}]}
BOOSTY_ONLY = {"requirements": [{"provider": "boosty", "min_tier_rank": 2}]}


def _v(state: str, tier: int | None = None, label: str | None = None) -> SubscriptionVerdict:
    return SubscriptionVerdict(
        state=state,
        tier_rank=tier,
        tier_label=label,
        source="test",
        checked_at=datetime.now(UTC),
        expires_at=None,
        evidence={"reason": "because"} if state == SubscriptionState.UNKNOWN else {},
    )


ACTIVE_2 = _v(SubscriptionState.ACTIVE, 2, "Уровень 2")
ACTIVE_1 = _v(SubscriptionState.ACTIVE, 1)
INACTIVE = _v(SubscriptionState.INACTIVE)
UNKNOWN = _v(SubscriptionState.UNKNOWN)


class _Form:
    """Only the toggle and the workspace now -- the rule moved to the workspace."""

    def __init__(self, *, require_subscription=True, workspace_id=7):
        self.require_subscription = require_subscription
        self.workspace_id = workspace_id


class _Resolver:
    def __init__(self, per_user: dict[int, dict[str, SubscriptionVerdict]], blob: dict | None = None) -> None:
        self._per_user = per_user
        # The workspace rule; `EITHER` keeps the default every case below assumed.
        self._blob = EITHER if blob is None else blob
        self.calls: list[dict] = []

    async def load_requirement(self, *, workspace_id):
        return _rule(self._blob)

    async def evaluate(self, *, workspace_id, auth_user_ids, requirement, force_refresh=False):
        self.calls.append(
            {
                "workspace_id": workspace_id,
                "auth_user_ids": list(auth_user_ids),
                "providers": list(requirement.providers),
                "force_refresh": force_refresh,
            }
        )
        return {
            uid: (
                evaluate_requirement(requirement, self._per_user.get(uid, {})),
                self._per_user.get(uid, {}),
            )
            for uid in auth_user_ids
        }


class TestNotRequired(IsolatedAsyncioTestCase):
    async def test_toggle_off_returns_empty_and_never_resolves(self):
        resolver = _Resolver({1: {"boosty": INACTIVE}})
        result = await build_subscription_reads(
            form=_Form(require_subscription=False),
            auth_user_id_by_registration={10: 1},
            resolver=resolver,
        )
        assert result == {}
        assert resolver.calls == []

    async def test_missing_form_returns_empty(self):
        resolver = _Resolver({})
        result = await build_subscription_reads(form=None, auth_user_id_by_registration={10: 1}, resolver=resolver)
        assert result == {}
        assert resolver.calls == []

    async def test_empty_requirement_returns_empty(self):
        resolver = _Resolver({}, {})
        result = await build_subscription_reads(form=_Form(), auth_user_id_by_registration={10: 1}, resolver=resolver)
        assert result == {}
        assert resolver.calls == []

    async def test_no_registrations_returns_empty(self):
        resolver = _Resolver({})
        result = await build_subscription_reads(form=_Form(), auth_user_id_by_registration={}, resolver=resolver)
        assert result == {}
        assert resolver.calls == []


class TestBatching(IsolatedAsyncioTestCase):
    async def test_resolves_the_whole_batch_in_one_call(self):
        resolver = _Resolver({1: {"boosty": ACTIVE_2}, 2: {"boosty": INACTIVE}})
        await build_subscription_reads(
            form=_Form(),
            auth_user_id_by_registration={10: 1, 11: 2, 12: 3},
            resolver=resolver,
        )
        assert len(resolver.calls) == 1
        assert resolver.calls[0]["auth_user_ids"] == [1, 2, 3]

    async def test_never_force_refreshes_on_a_list_read(self):
        """Only check-in forces a fresh resolve, and only for one user."""
        resolver = _Resolver({1: {"boosty": ACTIVE_2}})
        await build_subscription_reads(form=_Form(), auth_user_id_by_registration={10: 1}, resolver=resolver)
        assert resolver.calls[0]["force_refresh"] is False

    async def test_deduplicates_users_sharing_an_account(self):
        resolver = _Resolver({1: {"boosty": ACTIVE_2}})
        await build_subscription_reads(form=_Form(), auth_user_id_by_registration={10: 1, 11: 1}, resolver=resolver)
        assert resolver.calls[0]["auth_user_ids"] == [1]

    async def test_registrations_without_an_account_are_skipped(self):
        """A registration with no linked site account cannot have a verdict."""
        resolver = _Resolver({1: {"boosty": ACTIVE_2}})
        result = await build_subscription_reads(
            form=_Form(),
            auth_user_id_by_registration={10: 1, 11: None},
            resolver=resolver,
        )
        assert resolver.calls[0]["auth_user_ids"] == [1]
        assert 11 not in result


class TestPerRegistrationPayload(IsolatedAsyncioTestCase):
    async def test_maps_outcome_back_onto_every_registration(self):
        resolver = _Resolver({1: {"boosty": ACTIVE_2}, 2: {"boosty": INACTIVE}}, BOOSTY_ONLY)
        result = await build_subscription_reads(
            form=_Form(),
            auth_user_id_by_registration={10: 1, 11: 2},
            resolver=resolver,
        )
        assert result[10].outcome is Outcome.SATISFIED
        assert result[11].outcome is Outcome.REFUSED

    async def test_two_registrations_of_one_account_share_the_verdict(self):
        resolver = _Resolver({1: {"boosty": ACTIVE_2}}, BOOSTY_ONLY)
        result = await build_subscription_reads(
            form=_Form(),
            auth_user_id_by_registration={10: 1, 11: 1},
            resolver=resolver,
        )
        assert result[10].outcome is result[11].outcome

    async def test_carries_per_provider_verdicts_for_the_chips(self):
        resolver = _Resolver({1: {"boosty": INACTIVE, "twitch": ACTIVE_1}}, EITHER)
        result = await build_subscription_reads(
            form=_Form(),
            auth_user_id_by_registration={10: 1},
            resolver=resolver,
        )
        assert set(result[10].verdicts) == {"boosty", "twitch"}
        assert result[10].verdicts["twitch"].state == SubscriptionState.ACTIVE

    async def test_any_mode_passes_even_though_one_chip_is_red(self):
        """The exact case the UI summary line exists for."""
        resolver = _Resolver({1: {"boosty": INACTIVE, "twitch": ACTIVE_1}}, EITHER)
        result = await build_subscription_reads(
            form=_Form(),
            auth_user_id_by_registration={10: 1},
            resolver=resolver,
        )
        assert result[10].outcome is Outcome.SATISFIED
        assert result[10].verdicts["boosty"].state == SubscriptionState.INACTIVE


class TestSerializeVerdicts:
    def test_shape_is_json_friendly(self):
        payload = serialize_verdicts({"boosty": ACTIVE_2})
        assert payload["boosty"]["state"] == "active"
        assert payload["boosty"]["tier_rank"] == 2
        assert payload["boosty"]["tier_label"] == "Уровень 2"

    def test_carries_the_unknown_reason_for_the_ui_cta(self):
        """The frontend branches on `reason` to choose "link Discord" vs
        "reconnect Twitch"."""
        payload = serialize_verdicts({"twitch": UNKNOWN})
        assert payload["twitch"]["reason"] == "because"

    def test_omits_reason_when_there_is_none(self):
        payload = serialize_verdicts({"boosty": ACTIVE_2})
        assert payload["boosty"].get("reason") is None

    def test_does_not_leak_internal_evidence(self):
        """`evidence` can hold guild ids and role ids — not for public reads."""
        verdict = SubscriptionVerdict(
            state="active",
            tier_rank=1,
            tier_label=None,
            source="discord_role",
            checked_at=datetime.now(UTC),
            expires_at=None,
            evidence={"guild_id": "999", "held_role_ids": ["1", "2"], "reason": "ok"},
        )
        payload = serialize_verdicts({"boosty": verdict})
        assert "guild_id" not in payload["boosty"]
        assert "held_role_ids" not in payload["boosty"]


class TestReadSchema:
    @staticmethod
    def _read(**overrides):
        return RegistrationRead(id=1, tournament_id=10, workspace_id=7, **overrides)

    def test_defaults_to_absent(self):
        read = self._read()
        assert read.subscription_outcome is None
        assert read.subscription_verdicts is None

    def test_accepts_outcome_and_verdicts(self):
        read = self._read(
            subscription_outcome="refused",
            subscription_verdicts={"boosty": {"state": "inactive"}},
        )
        assert read.subscription_outcome == "refused"
        assert read.subscription_verdicts["boosty"]["state"] == "inactive"
