"""How the chosen verification method changes what the resolver will accept.

Two states were unreachable before the method existed, and each has a test here
that fails loudly without it:

- ``test_stale_user_is_refused_not_unknown`` — code-only used to answer ``unknown``
  (via ``guild_not_configured``), which fails open, so the gate admitted everybody.
- ``test_live_only_discards_a_stored_redeemed_code`` — a redeemed code is never
  re-polled, so switching to roles could not revoke it.

Same injected-boundary harness as ``test_resolve_subscriptions``: no DB, no network.
Runs under stdlib unittest -- there is no pytest-asyncio here.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from unittest import IsolatedAsyncioTestCase

from shared.services.subscriptions import (
    SubscriptionSource,
    SubscriptionState,
    SubscriptionVerdict,
    VerificationMethod,
)
from shared.services.subscriptions.entitlements import (
    SUBSCRIPTION_TTL_SECONDS,
    ProviderConfigRow,
    StoredEntitlement,
    SubscriptionResolver,
)

WS = 7
NOW = datetime(2026, 8, 3, 12, 0, tzinfo=UTC)
CODES = [{"code_sha256": "a" * 64, "tier_rank": 1}]


def _verdict(state: str, *, tier: int | None = None, source: str = SubscriptionSource.DISCORD_ROLE):
    return SubscriptionVerdict(
        state=state,
        tier_rank=tier,
        tier_label=None,
        source=source,
        checked_at=NOW,
        expires_at=NOW + timedelta(seconds=SUBSCRIPTION_TTL_SECONDS),
        evidence={},
    )


def _stored(
    state: str,
    *,
    tier: int | None = None,
    source: str,
    age_seconds: int = 0,
    expires_in: int | None = None,
) -> StoredEntitlement:
    return StoredEntitlement(
        state=state,
        tier_rank=tier,
        tier_label=None,
        source=source,
        checked_at=NOW - timedelta(seconds=age_seconds),
        expires_at=None if expires_in is None else NOW + timedelta(seconds=expires_in),
        evidence={},
    )


class _FakeStore:
    def __init__(self, *, configs=None, stored=None) -> None:
        self._configs = configs or {}
        self._stored = stored or {}
        self.upserts: list[tuple[int, int, str, SubscriptionVerdict]] = []

    async def load_configs(self, workspace_id, providers):
        return {p: self._configs[p] for p in providers if p in self._configs}

    async def load_entitlements(self, workspace_id, auth_user_ids, providers):
        return {
            key: row for key, row in self._stored.items() if key[0] in set(auth_user_ids) and key[1] in set(providers)
        }

    async def upsert(self, workspace_id, auth_user_id, provider, verdict):
        self.upserts.append((workspace_id, auth_user_id, provider, verdict))

    async def upsert_many(self, workspace_id, provider, verdicts):
        for auth_user_id, verdict in verdicts.items():
            self.upserts.append((workspace_id, auth_user_id, provider, verdict))


class _FakeStrategy:
    def __init__(self, default=None) -> None:
        self._default = default
        self.calls: list[tuple[dict[str, Any], tuple[int, ...]]] = []

    async def resolve_many(self, *, config, auth_user_ids):
        self.calls.append((config, tuple(auth_user_ids)))
        return dict.fromkeys(auth_user_ids, self._default) if self._default else {}


def _config(method: str, **extra: Any) -> ProviderConfigRow:
    return ProviderConfigRow(
        provider="boosty",
        enabled=True,
        config={
            "guild_id": "9",
            "role_tiers": [{"role_id": "1", "tier_rank": 1}],
            "verification_method": method,
            **extra,
        },
    )


def _resolve(store, strategies):
    return SubscriptionResolver(store=store, strategies=strategies, now=lambda: NOW).resolve(
        workspace_id=WS, auth_user_ids=[1], providers=["boosty"]
    )


class TestCodeOnlyNeverPolls(IsolatedAsyncioTestCase):
    async def test_stale_user_is_refused_not_unknown(self):
        """The regression that made code-only pointless: an unredeemed patron must
        be a confirmed refusal, because `unknown` fails open."""
        store = _FakeStore(configs={"boosty": _config(VerificationMethod.CODE, codes=CODES)})
        strategy = _FakeStrategy(_verdict(SubscriptionState.ACTIVE, tier=3))

        result = await _resolve(store, {"boosty": strategy})

        assert result[1]["boosty"].state == SubscriptionState.INACTIVE
        assert result[1]["boosty"].evidence["reason"] == "no_code_redeemed"
        assert strategy.calls == [], "code-only must not spend a Discord call"

    async def test_the_refusal_is_not_persisted(self):
        """It is derived from the absence of a row; writing it would only invite
        staleness and one row per participant per check-in."""
        store = _FakeStore(configs={"boosty": _config(VerificationMethod.CODE, codes=CODES)})
        await _resolve(store, {"boosty": _FakeStrategy()})
        assert store.upserts == []

    async def test_a_redeemed_code_still_counts(self):
        store = _FakeStore(
            configs={"boosty": _config(VerificationMethod.CODE, codes=CODES)},
            stored={(1, "boosty"): _stored(SubscriptionState.ACTIVE, tier=2, source=SubscriptionSource.CHALLENGE_CODE)},
        )
        strategy = _FakeStrategy()

        result = await _resolve(store, {"boosty": strategy})

        assert result[1]["boosty"].state == SubscriptionState.ACTIVE
        assert result[1]["boosty"].tier_rank == 2
        assert strategy.calls == []

    async def test_code_only_discards_a_stored_role_verdict(self):
        """A role-derived entitlement must stop counting once roles are no longer
        an accepted proof."""
        store = _FakeStore(
            configs={"boosty": _config(VerificationMethod.CODE, codes=CODES)},
            stored={(1, "boosty"): _stored(SubscriptionState.ACTIVE, tier=3, source=SubscriptionSource.DISCORD_ROLE)},
        )

        result = await _resolve(store, {"boosty": _FakeStrategy()})

        assert result[1]["boosty"].state == SubscriptionState.INACTIVE
        assert result[1]["boosty"].evidence["reason"] == "no_code_redeemed"

    async def test_code_only_works_without_a_strategy_at_all(self):
        """Nothing is polled, so a missing strategy is irrelevant rather than an
        `unknown` that fails open."""
        store = _FakeStore(configs={"boosty": _config(VerificationMethod.CODE, codes=CODES)})

        result = await _resolve(store, {})

        assert result[1]["boosty"].evidence["reason"] == "no_code_redeemed"

    async def test_code_only_with_no_codes_configured_fails_open(self):
        """An unsatisfiable requirement is an organizer error, and every organizer
        error fails open."""
        store = _FakeStore(configs={"boosty": _config(VerificationMethod.CODE)})

        result = await _resolve(store, {"boosty": _FakeStrategy()})

        assert result[1]["boosty"].state == SubscriptionState.UNKNOWN
        assert result[1]["boosty"].evidence["reason"] == "no_codes_configured"


class TestLiveOnly(IsolatedAsyncioTestCase):
    async def test_live_only_discards_a_stored_redeemed_code(self):
        """The other regression: a code is deliberately never re-polled, so only
        rejecting it by source can revoke it."""
        store = _FakeStore(
            configs={"boosty": _config(VerificationMethod.LIVE)},
            stored={
                (1, "boosty"): _stored(
                    SubscriptionState.ACTIVE, tier=3, source=SubscriptionSource.CHALLENGE_CODE, expires_in=9999
                )
            },
        )
        strategy = _FakeStrategy(_verdict(SubscriptionState.INACTIVE))

        result = await _resolve(store, {"boosty": strategy})

        assert result[1]["boosty"].state == SubscriptionState.INACTIVE
        assert strategy.calls, "the live signal must be consulted instead"

    async def test_live_only_keeps_a_fresh_role_verdict(self):
        store = _FakeStore(
            configs={"boosty": _config(VerificationMethod.LIVE)},
            stored={(1, "boosty"): _stored(SubscriptionState.ACTIVE, tier=2, source=SubscriptionSource.DISCORD_ROLE)},
        )
        strategy = _FakeStrategy()

        result = await _resolve(store, {"boosty": strategy})

        assert result[1]["boosty"].tier_rank == 2
        assert strategy.calls == []

    async def test_live_only_still_reports_a_missing_strategy(self):
        store = _FakeStore(configs={"boosty": _config(VerificationMethod.LIVE)})

        result = await _resolve(store, {})

        assert result[1]["boosty"].evidence["reason"] == "no_strategy_for_provider"


class TestAnyKeepsTodaysBehaviour(IsolatedAsyncioTestCase):
    async def test_a_config_without_the_field_polls_and_honours_codes(self):
        """Every config written before this feature must behave identically."""
        store = _FakeStore(
            configs={"boosty": ProviderConfigRow(provider="boosty", enabled=True, config={"guild_id": "9"})},
            stored={
                (1, "boosty"): _stored(
                    SubscriptionState.ACTIVE, tier=1, source=SubscriptionSource.CHALLENGE_CODE, expires_in=9999
                )
            },
        )
        strategy = _FakeStrategy()

        result = await _resolve(store, {"boosty": strategy})

        assert result[1]["boosty"].state == SubscriptionState.ACTIVE
        assert strategy.calls == []

    async def test_any_polls_when_there_is_no_stored_row(self):
        store = _FakeStore(configs={"boosty": _config(VerificationMethod.ANY)})
        strategy = _FakeStrategy(_verdict(SubscriptionState.ACTIVE, tier=2))

        result = await _resolve(store, {"boosty": strategy})

        assert result[1]["boosty"].tier_rank == 2
        assert strategy.calls

    async def test_an_unrecognised_method_widens_to_any(self):
        store = _FakeStore(configs={"boosty": _config("discord_role")})
        strategy = _FakeStrategy(_verdict(SubscriptionState.ACTIVE, tier=1))

        result = await _resolve(store, {"boosty": strategy})

        assert strategy.calls, "a typo must not silently stop resolution"
        assert result[1]["boosty"].state == SubscriptionState.ACTIVE
