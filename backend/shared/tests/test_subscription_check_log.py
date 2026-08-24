"""What the resolver appends to the collection history, and what it must not.

The history feed is only useful if it means one thing: *a live provider call
happened*. A cache hit or a code-only refusal did not call anybody, so logging it
would turn the admin task feed into a rendering of how often something read the
entitlement table. These tests pin that boundary.

No database — the sink is the same injected boundary as the store.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest import IsolatedAsyncioTestCase

from shared.core.enums import SubscriptionCheckState, SubscriptionCollectionSource
from shared.services.subscriptions.entitlements import (
    SUBSCRIPTION_TTL_SECONDS,
    ProviderConfigRow,
    StoredEntitlement,
    SubscriptionResolver,
)
from shared.services.subscriptions import SubscriptionSource, SubscriptionState, SubscriptionVerdict

WS = 7
NOW = datetime(2026, 8, 4, 12, 0, tzinfo=UTC)


def _verdict(state: str, *, tier: int | None = None, source: str = "discord_role", reason: str | None = None):
    return SubscriptionVerdict(
        state=state,
        tier_rank=tier,
        tier_label=f"Tier {tier}" if tier else None,
        source=source,
        checked_at=NOW,
        expires_at=NOW + timedelta(seconds=SUBSCRIPTION_TTL_SECONDS),
        evidence={"reason": reason} if reason else {},
    )


class _Store:
    def __init__(self, *, configs=None, stored=None) -> None:
        self._configs = configs or {}
        self._stored = stored or {}
        self.upserts: list[tuple] = []

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


class _Sink:
    def __init__(self, *, error: Exception | None = None) -> None:
        self.rows: list[dict] = []
        self._error = error

    async def log_check(self, **row):
        if self._error is not None:
            raise self._error
        self.rows.append(row)


class _Strategy:
    def __init__(self, verdicts=None, *, error: Exception | None = None) -> None:
        self._verdicts = verdicts or {}
        self._error = error

    async def resolve_many(self, *, config, auth_user_ids):
        if self._error is not None:
            raise self._error
        return {uid: v for uid, v in self._verdicts.items() if uid in set(auth_user_ids)}


def _enabled(provider: str, config: dict | None = None) -> ProviderConfigRow:
    return ProviderConfigRow(provider=provider, enabled=True, config=config or {"guild_id": "9"})


def _resolver(store, strategies, sink=None) -> SubscriptionResolver:
    return SubscriptionResolver(store=store, strategies=strategies, now=lambda: NOW, log_sink=sink)


class TestLivePathIsLogged(IsolatedAsyncioTestCase):
    async def test_successful_check_records_state_tier_mechanism_and_trigger(self):
        store = _Store(configs={"boosty": _enabled("boosty")})
        sink = _Sink()
        strategy = _Strategy({1: _verdict(SubscriptionState.ACTIVE, tier=2, reason="role_matched")})

        await _resolver(store, {"boosty": strategy}, sink).resolve(
            workspace_id=WS,
            auth_user_ids=[1],
            providers=["boosty"],
            source=SubscriptionCollectionSource.manual,
        )

        assert len(sink.rows) == 1
        row = sink.rows[0]
        assert row["workspace_id"] == WS
        assert row["auth_user_id"] == 1
        assert row["provider"] == "boosty"
        assert row["state"] == SubscriptionState.ACTIVE
        assert row["source"] == SubscriptionCollectionSource.manual
        # `source` is the trigger; the mechanism that proved it rides on the verdict.
        assert row["verdict"].source == "discord_role"
        assert row["error"] is None

    async def test_inactive_is_logged_too(self):
        """ "Not subscribed" is a result, not a non-event: the flap is the history."""
        store = _Store(configs={"boosty": _enabled("boosty")})
        sink = _Sink()
        strategy = _Strategy({1: _verdict(SubscriptionState.INACTIVE, reason="no_mapped_role")})

        await _resolver(store, {"boosty": strategy}, sink).resolve(
            workspace_id=WS, auth_user_ids=[1], providers=["boosty"]
        )

        assert [r["state"] for r in sink.rows] == [SubscriptionState.INACTIVE]
        assert sink.rows[0]["source"] == SubscriptionCollectionSource.scheduled

    async def test_strategy_explosion_is_logged_as_error_per_user(self):
        """The one thing the resolver otherwise leaves no trace of.

        A crashed strategy persists no entitlement on purpose, so without a log row
        a provider outage would be indistinguishable from a provider nobody
        configured.
        """
        store = _Store(configs={"boosty": _enabled("boosty")})
        sink = _Sink()
        strategy = _Strategy(error=RuntimeError("discord 503"))

        await _resolver(store, {"boosty": strategy}, sink).resolve(
            workspace_id=WS, auth_user_ids=[1, 2], providers=["boosty"]
        )

        assert [r["auth_user_id"] for r in sink.rows] == [1, 2]
        assert {r["state"] for r in sink.rows} == {SubscriptionCheckState.error}
        assert sink.rows[0]["error"] == "RuntimeError: discord 503"
        assert store.upserts == []

    async def test_strategy_declining_to_answer_is_logged_as_unknown(self):
        store = _Store(configs={"boosty": _enabled("boosty")})
        sink = _Sink()

        await _resolver(store, {"boosty": _Strategy({})}, sink).resolve(
            workspace_id=WS, auth_user_ids=[1], providers=["boosty"]
        )

        assert [r["state"] for r in sink.rows] == [SubscriptionState.UNKNOWN]
        assert sink.rows[0]["verdict"].evidence["reason"] == "not_resolved"


class TestNonAttemptsAreNotLogged(IsolatedAsyncioTestCase):
    async def test_cache_hit_logs_nothing(self):
        """Nobody was called, so there is no attempt to record."""
        store = _Store(
            configs={"boosty": _enabled("boosty")},
            stored={
                (1, "boosty"): StoredEntitlement(
                    state=SubscriptionState.ACTIVE,
                    tier_rank=2,
                    tier_label="Tier 2",
                    source="discord_role",
                    checked_at=NOW - timedelta(seconds=10),
                    expires_at=None,
                )
            },
        )
        sink = _Sink()

        await _resolver(store, {"boosty": _Strategy()}, sink).resolve(
            workspace_id=WS, auth_user_ids=[1], providers=["boosty"]
        )

        assert sink.rows == []

    async def test_unusable_provider_logs_nothing(self):
        """A provider nobody configured is a settings problem, not a check."""
        sink = _Sink()

        await _resolver(_Store(), {}, sink).resolve(workspace_id=WS, auth_user_ids=[1], providers=["boosty"])

        assert sink.rows == []

    async def test_code_only_refusal_logs_nothing(self):
        """Derived from the absence of a row — no provider was asked."""
        store = _Store(
            configs={
                "boosty": _enabled(
                    "boosty",
                    {"verification_method": "code", "codes": [{"code_sha256": "x" * 64, "tier_rank": 1}]},
                )
            }
        )
        sink = _Sink()

        out = await _resolver(store, {}, sink).resolve(workspace_id=WS, auth_user_ids=[1], providers=["boosty"])

        assert out[1]["boosty"].state == SubscriptionState.INACTIVE
        assert out[1]["boosty"].source == SubscriptionSource.CHALLENGE_CODE
        assert sink.rows == []


class TestSinkIsOptionalAndNonFatal(IsolatedAsyncioTestCase):
    async def test_resolver_without_a_sink_still_resolves(self):
        store = _Store(configs={"boosty": _enabled("boosty")})
        strategy = _Strategy({1: _verdict(SubscriptionState.ACTIVE, tier=2)})

        out = await _resolver(store, {"boosty": strategy}).resolve(
            workspace_id=WS, auth_user_ids=[1], providers=["boosty"]
        )

        assert out[1]["boosty"].state == SubscriptionState.ACTIVE
        assert len(store.upserts) == 1

    async def test_a_broken_sink_never_breaks_the_verdict(self):
        """History is diagnostics: losing a row must not fail an admission."""
        store = _Store(configs={"boosty": _enabled("boosty")})
        strategy = _Strategy({1: _verdict(SubscriptionState.ACTIVE, tier=2)})

        out = await _resolver(store, {"boosty": strategy}, _Sink(error=RuntimeError("log table gone"))).resolve(
            workspace_id=WS, auth_user_ids=[1], providers=["boosty"]
        )

        assert out[1]["boosty"].state == SubscriptionState.ACTIVE
        assert len(store.upserts) == 1
