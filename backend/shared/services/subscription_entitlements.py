"""Resolve and compose subscription entitlements.

Public face of the subscription module. Two entry points:

- ``SubscriptionResolver.resolve`` -- batched raw verdicts, keyed
  ``{auth_user_id: {provider: verdict}}``. Shape deliberately mirrors
  ``shared.services.profile_visibility.resolve_profiles_open``, widened by one
  dimension because a tournament may require several providers at once.
- ``SubscriptionResolver.evaluate`` -- folds those verdicts through the Kleene
  composition in ``shared.subscriptions.requirement`` and returns the composed
  ``Outcome`` **alongside** the per-provider verdicts, so the UI can render a chip
  per provider without a second round of provider calls.

Two invariants worth keeping:

1. **Total coverage.** Every requested user appears in the outer dict and every
   requested provider in each inner dict. ``evaluate_requirement`` reads a missing
   key as ``UNDETERMINED``, so a gap here would be indistinguishable from a real
   outage.
2. **A failure never overwrites a good verdict.** A crashed strategy yields
   ``unknown`` for that provider and persists nothing, so the last known state
   survives the outage.

Persistence and live provider calls are injected (``EntitlementStore``,
``strategies``) so the whole decision table is testable without a database or a
network.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any, Final, Protocol

from shared.subscriptions import (
    Outcome,
    SubscriptionRequirement,
    SubscriptionSource,
    SubscriptionState,
    SubscriptionVerdict,
    evaluate_requirement,
)

__all__ = (
    "SUBSCRIPTION_TTL_SECONDS",
    "EntitlementStore",
    "ProviderConfigRow",
    "ProviderStrategy",
    "StoredEntitlement",
    "SubscriptionResolver",
)

SUBSCRIPTION_TTL_SECONDS: Final = 15 * 60


@dataclass(frozen=True, slots=True)
class ProviderConfigRow:
    provider: str
    enabled: bool
    config: dict[str, Any]


@dataclass(frozen=True, slots=True)
class StoredEntitlement:
    """A persisted verdict, as read back from ``subscriptions.entitlement``."""

    state: str
    tier_rank: int | None
    tier_label: str | None
    source: str | None
    checked_at: datetime | None
    expires_at: datetime | None
    evidence: dict[str, Any] = field(default_factory=dict)

    def to_verdict(self) -> SubscriptionVerdict:
        return SubscriptionVerdict(
            state=self.state,  # type: ignore[arg-type]
            tier_rank=self.tier_rank,
            tier_label=self.tier_label,
            source=self.source or "stored",
            checked_at=self.checked_at or datetime.now(UTC),
            expires_at=self.expires_at,
            evidence=dict(self.evidence),
        )


class EntitlementStore(Protocol):
    """Data-access boundary. One call per concern, never one per provider."""

    async def load_configs(self, workspace_id: int, providers: Sequence[str]) -> dict[str, ProviderConfigRow]: ...

    async def load_entitlements(
        self,
        workspace_id: int,
        auth_user_ids: Sequence[int],
        providers: Sequence[str],
    ) -> dict[tuple[int, str], StoredEntitlement]: ...

    async def upsert(
        self,
        workspace_id: int,
        auth_user_id: int,
        provider: str,
        verdict: SubscriptionVerdict,
    ) -> None: ...


class ProviderStrategy(Protocol):
    """Live resolution for one provider across a batch of users.

    The strategy owns its own identity lookup (which OAuth connection maps to
    which external id), so the resolver stays purely about config and caching.
    """

    async def resolve_many(
        self, *, config: dict[str, Any], auth_user_ids: Sequence[int]
    ) -> dict[int, SubscriptionVerdict]: ...


class SubscriptionResolver:
    def __init__(
        self,
        *,
        store: EntitlementStore,
        strategies: Mapping[str, ProviderStrategy],
        now: Callable[[], datetime] | None = None,
        ttl_seconds: int = SUBSCRIPTION_TTL_SECONDS,
    ) -> None:
        self._store = store
        self._strategies = strategies
        self._now = now or (lambda: datetime.now(UTC))
        self._ttl_seconds = ttl_seconds

    # ── raw verdicts ──────────────────────────────────────────────────────────

    async def resolve(
        self,
        *,
        workspace_id: int,
        auth_user_ids: Sequence[int],
        providers: Sequence[str],
        force_refresh: bool = False,
    ) -> dict[int, dict[str, SubscriptionVerdict]]:
        user_ids = list(dict.fromkeys(auth_user_ids))
        wanted = list(dict.fromkeys(providers))
        if not user_ids or not wanted:
            return {}

        configs = await self._store.load_configs(workspace_id, wanted)
        stored = await self._store.load_entitlements(workspace_id, user_ids, wanted)

        out: dict[int, dict[str, SubscriptionVerdict]] = {uid: {} for uid in user_ids}

        for provider in wanted:
            unusable = self._unusable_reason(provider, configs.get(provider))
            if unusable is not None:
                for uid in user_ids:
                    out[uid][provider] = self._unknown(unusable)
                continue

            config = configs[provider].config
            stale: list[int] = []
            for uid in user_ids:
                row = stored.get((uid, provider))
                if row is not None and self._is_usable(row, force_refresh=force_refresh):
                    out[uid][provider] = row.to_verdict()
                else:
                    stale.append(uid)

            if not stale:
                continue

            try:
                fresh = await self._strategies[provider].resolve_many(config=config, auth_user_ids=stale)
            except Exception:
                # Isolate the blast radius: this provider is unknown for these
                # users, nothing is persisted, every other provider is untouched.
                for uid in stale:
                    out[uid][provider] = self._unknown("strategy_error")
                continue

            for uid in stale:
                verdict = fresh.get(uid)
                if verdict is None:
                    # The strategy declined to answer. Treated as unknown rather
                    # than silently omitted -- see the total-coverage invariant.
                    out[uid][provider] = self._unknown("not_resolved")
                    continue
                out[uid][provider] = verdict
                await self._store.upsert(workspace_id, uid, provider, verdict)

        return out

    # ── composed admission answer ─────────────────────────────────────────────

    async def evaluate(
        self,
        *,
        workspace_id: int,
        auth_user_ids: Sequence[int],
        requirement: SubscriptionRequirement,
        force_refresh: bool = False,
    ) -> dict[int, tuple[Outcome, dict[str, SubscriptionVerdict]]]:
        user_ids = list(dict.fromkeys(auth_user_ids))
        if not requirement.requirements:
            return {uid: (Outcome.SATISFIED, {}) for uid in user_ids}

        verdicts = await self.resolve(
            workspace_id=workspace_id,
            auth_user_ids=user_ids,
            providers=requirement.providers,
            force_refresh=force_refresh,
        )
        return {
            uid: (evaluate_requirement(requirement, verdicts.get(uid, {})), verdicts.get(uid, {})) for uid in user_ids
        }

    # ── internals ─────────────────────────────────────────────────────────────

    def _unusable_reason(self, provider: str, config: ProviderConfigRow | None) -> str | None:
        """Why this provider cannot answer at all, or ``None`` if it can.

        Every branch here is the ORGANIZER's problem, so all of them resolve to
        ``unknown`` (fail open) -- never to a refusal.
        """
        if config is None:
            return "provider_not_configured"
        if not config.enabled:
            return "provider_disabled"
        if provider not in self._strategies:
            return "no_strategy_for_provider"
        return None

    def _is_usable(self, row: StoredEntitlement, *, force_refresh: bool) -> bool:
        now = self._now()
        expired = row.expires_at is not None and row.expires_at <= now

        # A redeemed challenge code has nothing to re-poll: it is conclusive until
        # its own expiry. `force_refresh` (check-in) must not revoke it by asking
        # Discord, which knows nothing about codes.
        if row.source == SubscriptionSource.CHALLENGE_CODE:
            return not expired

        if force_refresh or expired or row.checked_at is None:
            return False
        return (now - row.checked_at).total_seconds() < self._ttl_seconds

    def _unknown(self, reason: str) -> SubscriptionVerdict:
        now = self._now()
        return SubscriptionVerdict(
            state=SubscriptionState.UNKNOWN,
            tier_rank=None,
            tier_label=None,
            source="resolver",
            checked_at=now,
            expires_at=now + timedelta(seconds=self._ttl_seconds),
            evidence={"reason": reason},
        )
