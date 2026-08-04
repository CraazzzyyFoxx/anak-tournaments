"""The registration (sign-up) subscription gate.

Signing up used to be ungated entirely; check-in was the only enforcement point.
That let a confirmed non-subscriber occupy a slot for the whole registration
window and discover the refusal only once the roster was being built. This gate
closes that, but only for what can be decided WITHOUT asking the patron for
anything: a provider they could still satisfy by pasting a code from a
subscriber-only post is deferred, because that field is offered at check-in and
nowhere else.

So this file pins three things the composition tests cannot:

- the deferral set is asked for, and only when a refusal is on the table,
- an ``all``-mode refusal on an independently-verified provider still blocks,
- the refusal names sign-up, not check-in.

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
    SubscriptionState,
    SubscriptionVerdict,
    evaluate_requirement,
)
from src.services.registration.subscription_gate import (  # noqa: E402
    assert_subscription_allows_registration,
)

BOOSTY_ONLY = {"mode": "all", "requirements": [{"provider": "boosty", "min_tier_rank": 2}]}
BOTH = {"mode": "all", "requirements": [{"provider": "boosty"}, {"provider": "twitch"}]}
EITHER = {"mode": "any", "requirements": [{"provider": "boosty"}, {"provider": "twitch"}]}

USER = 42


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


class _Form:
    def __init__(self, *, require_subscription=False, blob=None, workspace_id=7):
        self.require_subscription = require_subscription
        self.subscription_requirement_json = blob or {}
        self.workspace_id = workspace_id


class _Resolver:
    """Real composition, faked I/O — and a log of both questions the gate asks."""

    def __init__(
        self,
        verdicts: dict[str, SubscriptionVerdict] | None = None,
        code_providers: set[str] | None = None,
    ) -> None:
        self._verdicts = verdicts or {}
        self._code_providers = code_providers or set()
        self.calls: list[dict] = []
        self.code_queries: list[tuple[int, tuple[str, ...]]] = []

    async def evaluate(self, *, workspace_id, auth_user_ids, requirement, force_refresh=False, source="scheduled"):
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

    async def accepted_code_providers(self, *, workspace_id, providers):
        self.code_queries.append((workspace_id, tuple(providers)))
        return self._code_providers


async def _gate(form, resolver, *, auth_user_id=USER):
    await assert_subscription_allows_registration(form=form, auth_user_id=auth_user_id, resolver=resolver)


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
        """No form means no tournament rule; submission fails later for its own reasons."""
        resolver = _Resolver({"boosty": INACTIVE})
        await _gate(None, resolver)
        assert resolver.calls == []

    async def test_malformed_blob_does_not_block_sign_up(self):
        resolver = _Resolver({"boosty": INACTIVE})
        await _gate(_Form(require_subscription=True, blob={"mode": "most", "requirements": []}), resolver)
        assert resolver.calls == []


class TestAutomaticVerdicts(IsolatedAsyncioTestCase):
    """No code involved: the gate is exactly the check-in gate."""

    async def test_active_at_threshold_passes(self):
        await _gate(_Form(require_subscription=True, blob=BOOSTY_ONLY), _Resolver({"boosty": ACTIVE_2}))

    async def test_below_threshold_blocks(self):
        with self.assertRaises(HTTPException) as ctx:
            await _gate(_Form(require_subscription=True, blob=BOOSTY_ONLY), _Resolver({"boosty": ACTIVE_1}))
        assert ctx.exception.status_code == 400

    async def test_confirmed_refusal_blocks(self):
        with self.assertRaises(HTTPException):
            await _gate(_Form(require_subscription=True, blob=BOOSTY_ONLY), _Resolver({"boosty": INACTIVE}))

    async def test_undetermined_passes(self):
        """A provider outage during open sign-ups must not lock anybody out."""
        await _gate(_Form(require_subscription=True, blob=BOOSTY_ONLY), _Resolver({"boosty": UNKNOWN}))


class TestCodeDeferral(IsolatedAsyncioTestCase):
    async def test_refusal_on_a_code_provider_is_deferred(self):
        """They have not been shown the field yet — refusing now would be a lie."""
        resolver = _Resolver({"boosty": INACTIVE}, {"boosty"})
        await _gate(_Form(require_subscription=True, blob=BOOSTY_ONLY), resolver)
        assert resolver.code_queries == [(7, ("boosty",))]

    async def test_any_mode_defers_when_a_code_could_still_satisfy_it(self):
        resolver = _Resolver({"boosty": INACTIVE, "twitch": INACTIVE}, {"boosty"})
        await _gate(_Form(require_subscription=True, blob=EITHER), resolver)

    async def test_all_mode_still_blocks_on_an_independent_refusal(self):
        """A Boosty code cannot rescue a Twitch refusal when both are required."""
        resolver = _Resolver({"boosty": INACTIVE, "twitch": INACTIVE}, {"boosty"})
        with self.assertRaises(HTTPException):
            await _gate(_Form(require_subscription=True, blob=BOTH), resolver)

    async def test_deferral_does_not_apply_to_a_provider_without_codes(self):
        resolver = _Resolver({"boosty": INACTIVE}, set())
        with self.assertRaises(HTTPException):
            await _gate(_Form(require_subscription=True, blob=BOOSTY_ONLY), resolver)
        # Asked, answered "no code path", refused.
        assert resolver.code_queries == [(7, ("boosty",))]

    async def test_no_code_query_when_nothing_is_refused(self):
        """Deferring can only weaken a refusal, so the happy path skips the read."""
        resolver = _Resolver({"boosty": ACTIVE_2}, {"boosty"})
        await _gate(_Form(require_subscription=True, blob=BOOSTY_ONLY), resolver)
        assert resolver.code_queries == []

    async def test_no_code_query_on_an_undetermined_verdict(self):
        resolver = _Resolver({"boosty": UNKNOWN}, {"boosty"})
        await _gate(_Form(require_subscription=True, blob=BOOSTY_ONLY), resolver)
        assert resolver.code_queries == []


class TestResolverContract(IsolatedAsyncioTestCase):
    async def test_forces_a_fresh_look_for_the_one_acting_user(self):
        resolver = _Resolver({"boosty": ACTIVE_2})
        await _gate(_Form(require_subscription=True, blob=BOOSTY_ONLY, workspace_id=13), resolver, auth_user_id=99)
        assert resolver.calls == [
            {
                "workspace_id": 13,
                "auth_user_ids": [99],
                "providers": ["boosty"],
                "force_refresh": True,
                # Tags the check-log row, so an organizer can later tell a signup
                # refusal apart from a background sweep or a manual re-check.
                "source": "registration",
            }
        ]


class TestRefusalMessage(IsolatedAsyncioTestCase):
    async def test_message_names_sign_up_and_the_rule(self):
        """A patron refused at sign-up must not read a check-in message."""
        with self.assertRaises(HTTPException) as ctx:
            await _gate(_Form(require_subscription=True, blob=BOOSTY_ONLY), _Resolver({"boosty": INACTIVE}))
        detail = ctx.exception.detail
        assert "регистрации" in detail
        assert "чек-ин" not in detail
        assert "Boosty" in detail
        assert "2" in detail

    async def test_any_mode_message_says_or(self):
        with self.assertRaises(HTTPException) as ctx:
            await _gate(
                _Form(require_subscription=True, blob=EITHER),
                _Resolver({"boosty": INACTIVE, "twitch": INACTIVE}),
            )
        assert " или " in ctx.exception.detail
