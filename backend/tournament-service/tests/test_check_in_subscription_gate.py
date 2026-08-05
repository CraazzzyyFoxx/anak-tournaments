"""The check-in subscription gate.

The gate is the only place a subscription is *enforced*. All the composition
subtlety lives in ``shared.subscriptions.requirement`` (unit-tested there); these
tests pin the gate's own contract:

- block IFF the composed outcome is REFUSED,
- never call the resolver when there is nothing to enforce,
- name the actual rule in the refusal message.

Runs under stdlib unittest -- no pytest-asyncio in this repo.
"""

from __future__ import annotations

import os
import sys
from datetime import UTC, datetime
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
from shared.subscriptions import (  # noqa: E402
    SubscriptionRequirement,
    SubscriptionState,
    SubscriptionVerdict,
    parse_requirement,
)
from src.services.registration.subscription_gate import (  # noqa: E402
    assert_subscription_allows_check_in,
    describe_requirement,
)

BOOSTY_ONLY = {"mode": "all", "requirements": [{"provider": "boosty", "min_tier_rank": 2}]}
BOTH = {
    "mode": "all",
    "requirements": [{"provider": "boosty"}, {"provider": "twitch"}],
}
EITHER = {
    "mode": "any",
    "requirements": [{"provider": "boosty"}, {"provider": "twitch"}],
}


def _v(state: str, tier: int | None = None) -> SubscriptionVerdict:
    return SubscriptionVerdict(
        state=state,
        tier_rank=tier,
        tier_label=None,
        source="test",
        checked_at=datetime.now(UTC),
        expires_at=None,
    )


ACTIVE_2 = _v(SubscriptionState.ACTIVE, 2)
ACTIVE_1 = _v(SubscriptionState.ACTIVE, 1)
INACTIVE = _v(SubscriptionState.INACTIVE)
UNKNOWN = _v(SubscriptionState.UNKNOWN)


def _rule(blob: dict | None) -> SubscriptionRequirement | None:
    """What the real resolver would hand back for ``blob``.

    Mirrors ``SubscriptionResolver.load_requirement``'s fail-open contract (unit-tested
    in ``shared/tests/test_subscription_load_requirement.py``) so the cases below keep
    exercising the gate's own decisions rather than the parse.
    """
    try:
        requirement = parse_requirement(blob)
    except ValueError:
        return None
    return requirement if requirement.requirements else None


class _Form:
    """Only the toggle and the workspace now -- the rule moved to the workspace.

    ``blob`` is kept as the test's way of saying "this workspace requires X"; ``_gate``
    hands it to the fake resolver, which is where the gate reads the rule from.
    """

    def __init__(self, *, require_subscription=False, blob=None, workspace_id=7):
        self.require_subscription = require_subscription
        self.workspace_id = workspace_id
        self.blob = blob or {}


class _Resolver:
    """Records whether the gate bothered to ask, and what it asked for."""

    def __init__(self, verdicts: dict[str, SubscriptionVerdict] | None = None) -> None:
        self._verdicts = verdicts or {}
        self.requirement: SubscriptionRequirement | None = None
        self.calls: list[dict] = []

    async def load_requirement(self, *, workspace_id):
        return self.requirement

    async def evaluate(self, *, workspace_id, auth_user_ids, requirement, force_refresh=False, source="scheduled"):
        from shared.subscriptions import evaluate_requirement

        self.calls.append(
            {
                "workspace_id": workspace_id,
                "auth_user_ids": list(auth_user_ids),
                "providers": list(requirement.providers),
                "force_refresh": force_refresh,
                "source": source,
            }
        )
        outcome = evaluate_requirement(requirement, self._verdicts)
        return dict.fromkeys(auth_user_ids, (outcome, self._verdicts))


async def _gate(form, resolver, *, auth_user_id=42):
    resolver.requirement = _rule(getattr(form, "blob", None))
    await assert_subscription_allows_check_in(form=form, auth_user_id=auth_user_id, resolver=resolver)


class TestNothingToEnforce(IsolatedAsyncioTestCase):
    async def test_toggle_off_never_asks_the_resolver(self):
        resolver = _Resolver({"boosty": INACTIVE})
        await _gate(_Form(require_subscription=False, blob=BOOSTY_ONLY), resolver)
        assert resolver.calls == []

    async def test_toggle_on_with_empty_requirement_never_asks(self):
        resolver = _Resolver({"boosty": INACTIVE})
        await _gate(_Form(require_subscription=True, blob={}), resolver)
        assert resolver.calls == []

    async def test_missing_form_is_a_no_op(self):
        resolver = _Resolver({"boosty": INACTIVE})
        await assert_subscription_allows_check_in(form=None, auth_user_id=1, resolver=resolver)
        assert resolver.calls == []

    async def test_malformed_blob_does_not_block_check_in(self):
        """A bad `mode` is rejected on save; if one slipped in anyway, refusing
        every patron mid-tournament would be the worse failure."""
        resolver = _Resolver({"boosty": INACTIVE})
        await _gate(
            _Form(require_subscription=True, blob={"mode": "most", "requirements": []}),
            resolver,
        )
        assert resolver.calls == []


class TestSingleProvider(IsolatedAsyncioTestCase):
    async def test_active_at_threshold_passes(self):
        await _gate(_Form(require_subscription=True, blob=BOOSTY_ONLY), _Resolver({"boosty": ACTIVE_2}))

    async def test_active_below_threshold_blocks(self):
        with self.assertRaises(HTTPException) as ctx:
            await _gate(
                _Form(require_subscription=True, blob=BOOSTY_ONLY),
                _Resolver({"boosty": ACTIVE_1}),
            )
        assert ctx.exception.status_code == 400

    async def test_inactive_blocks(self):
        with self.assertRaises(HTTPException):
            await _gate(
                _Form(require_subscription=True, blob=BOOSTY_ONLY),
                _Resolver({"boosty": INACTIVE}),
            )

    async def test_unknown_fails_open(self):
        """A provider outage must never block a live check-in."""
        await _gate(_Form(require_subscription=True, blob=BOOSTY_ONLY), _Resolver({"boosty": UNKNOWN}))


class TestAllMode(IsolatedAsyncioTestCase):
    async def test_both_active_passes(self):
        await _gate(
            _Form(require_subscription=True, blob=BOTH),
            _Resolver({"boosty": ACTIVE_1, "twitch": ACTIVE_1}),
        )

    async def test_one_inactive_blocks(self):
        with self.assertRaises(HTTPException):
            await _gate(
                _Form(require_subscription=True, blob=BOTH),
                _Resolver({"boosty": ACTIVE_1, "twitch": INACTIVE}),
            )

    async def test_inactive_plus_unknown_blocks(self):
        """Refusal dominates in `all`: certainty of failure outranks uncertainty."""
        with self.assertRaises(HTTPException):
            await _gate(
                _Form(require_subscription=True, blob=BOTH),
                _Resolver({"boosty": INACTIVE, "twitch": UNKNOWN}),
            )

    async def test_active_plus_unknown_passes(self):
        """One provider being down must not punish a verified patron."""
        await _gate(
            _Form(require_subscription=True, blob=BOTH),
            _Resolver({"boosty": ACTIVE_1, "twitch": UNKNOWN}),
        )


class TestAnyMode(IsolatedAsyncioTestCase):
    async def test_one_active_passes(self):
        await _gate(
            _Form(require_subscription=True, blob=EITHER),
            _Resolver({"boosty": INACTIVE, "twitch": ACTIVE_1}),
        )

    async def test_both_inactive_blocks(self):
        with self.assertRaises(HTTPException):
            await _gate(
                _Form(require_subscription=True, blob=EITHER),
                _Resolver({"boosty": INACTIVE, "twitch": INACTIVE}),
            )

    async def test_inactive_plus_unknown_passes(self):
        """THE regression this design exists to prevent: a Twitch outage must not
        turn a Boosty refusal into a hard block."""
        await _gate(
            _Form(require_subscription=True, blob=EITHER),
            _Resolver({"boosty": INACTIVE, "twitch": UNKNOWN}),
        )

    async def test_both_unknown_passes(self):
        await _gate(
            _Form(require_subscription=True, blob=EITHER),
            _Resolver({"boosty": UNKNOWN, "twitch": UNKNOWN}),
        )

    async def test_unconfigured_provider_does_not_block(self):
        """A provider the organizer never configured resolves to unknown."""
        await _gate(
            _Form(require_subscription=True, blob=EITHER),
            _Resolver({"boosty": INACTIVE}),
        )


class TestForceRefresh(IsolatedAsyncioTestCase):
    async def test_gate_always_forces_a_fresh_resolve(self):
        """Check-in is exactly the moment a stale `active` must not be trusted."""
        resolver = _Resolver({"boosty": ACTIVE_2})
        await _gate(_Form(require_subscription=True, blob=BOOSTY_ONLY), resolver)
        assert resolver.calls[0]["force_refresh"] is True

    async def test_labels_the_check_as_check_in(self):
        """The history row must name the trigger, not just the outcome."""
        resolver = _Resolver({"boosty": ACTIVE_2})
        await _gate(_Form(require_subscription=True, blob=BOOSTY_ONLY), resolver)
        assert resolver.calls[0]["source"] == "check_in"

    async def test_resolves_only_the_acting_user(self):
        resolver = _Resolver({"boosty": ACTIVE_2})
        await _gate(_Form(require_subscription=True, blob=BOOSTY_ONLY), resolver, auth_user_id=99)
        assert resolver.calls[0]["auth_user_ids"] == [99]

    async def test_passes_the_forms_workspace(self):
        resolver = _Resolver({"boosty": ACTIVE_2})
        form = _Form(require_subscription=True, blob=BOOSTY_ONLY, workspace_id=13)
        await _gate(form, resolver)
        assert resolver.calls[0]["workspace_id"] == 13


class TestRefusalMessage(IsolatedAsyncioTestCase):
    async def test_any_mode_message_says_or(self):
        with self.assertRaises(HTTPException) as ctx:
            await _gate(
                _Form(require_subscription=True, blob=EITHER),
                _Resolver({"boosty": INACTIVE, "twitch": INACTIVE}),
            )
        assert "или" in ctx.exception.detail

    async def test_all_mode_message_says_and(self):
        with self.assertRaises(HTTPException) as ctx:
            await _gate(
                _Form(require_subscription=True, blob=BOTH),
                _Resolver({"boosty": INACTIVE, "twitch": INACTIVE}),
            )
        assert " и " in ctx.exception.detail

    async def test_message_names_every_required_provider(self):
        with self.assertRaises(HTTPException) as ctx:
            await _gate(
                _Form(require_subscription=True, blob=EITHER),
                _Resolver({"boosty": INACTIVE, "twitch": INACTIVE}),
            )
        assert "Boosty" in ctx.exception.detail
        assert "Twitch" in ctx.exception.detail

    async def test_message_mentions_the_threshold(self):
        with self.assertRaises(HTTPException) as ctx:
            await _gate(
                _Form(require_subscription=True, blob=BOOSTY_ONLY),
                _Resolver({"boosty": INACTIVE}),
            )
        assert "2" in ctx.exception.detail


class TestDescribeRequirement:
    def test_single_provider_has_no_conjunction(self):
        from shared.subscriptions import parse_requirement

        text = describe_requirement(parse_requirement(BOOSTY_ONLY))
        assert " и " not in text
        assert "или" not in text

    def test_threshold_of_one_is_not_spelled_out(self):
        """ "Boosty уровень 1" reads like a restriction that is not there."""
        from shared.subscriptions import parse_requirement

        text = describe_requirement(parse_requirement({"requirements": [{"provider": "boosty"}]}))
        assert "1" not in text
