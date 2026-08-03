"""Compose per-provider subscription verdicts into one admission answer.

A tournament may require a subscription on one provider, on ALL of several, or on
ANY ONE of several, each with its own ``min_tier_rank`` (Boosty "Уровень 2" and
Twitch "Tier 2" are unrelated scales).

Composition uses **Kleene three-valued logic**, NOT boolean logic with ``unknown``
coerced to a side. Coercing ``unknown`` to false would make ``any[refused,
unknown]`` block, so one provider's outage would lock out every patron subscribed
via the other. Coercing it to true would make ``all[refused, unknown]`` pass,
admitting a confirmed non-subscriber. Kleene is the only mapping that preserves
"block only on certainty" in both modes.

The gate blocks IFF the composed outcome is ``REFUSED``.
"""

from __future__ import annotations

import enum
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Final, Literal

from shared.subscriptions.types import SubscriptionState, SubscriptionVerdict, meets_min_tier

__all__ = (
    "MODE_ALL",
    "MODE_ANY",
    "Outcome",
    "ProviderRequirement",
    "SubscriptionRequirement",
    "evaluate_requirement",
    "parse_requirement",
)

MODE_ALL: Final = "all"
MODE_ANY: Final = "any"
_MODES: Final = frozenset({MODE_ALL, MODE_ANY})


class Outcome(enum.Enum):
    """Kleene truth value of a composed requirement."""

    SATISFIED = "satisfied"  # T
    REFUSED = "refused"  # F
    UNDETERMINED = "undetermined"  # U

    @property
    def blocks_check_in(self) -> bool:
        """Only certainty of failure blocks. ``UNDETERMINED`` fails open."""
        return self is Outcome.REFUSED


@dataclass(frozen=True, slots=True)
class ProviderRequirement:
    provider: str
    min_tier_rank: int = 1


@dataclass(frozen=True, slots=True)
class SubscriptionRequirement:
    mode: Literal["any", "all"]
    requirements: tuple[ProviderRequirement, ...]

    @property
    def providers(self) -> tuple[str, ...]:
        """Distinct providers this requirement needs resolved.

        ``parse_requirement`` already deduplicates, so this is distinct by
        construction.
        """
        return tuple(req.provider for req in self.requirements)


def _evaluate_one(req: ProviderRequirement, verdict: SubscriptionVerdict | None) -> Outcome:
    # No verdict at all: the provider is unconfigured, disabled, or was not
    # resolved. That is the organizer's problem, never read as "not subscribed".
    if verdict is None or verdict.state == SubscriptionState.UNKNOWN:
        return Outcome.UNDETERMINED
    # meets_min_tier also fails open on unknown, which is already handled above;
    # here it is a pure active/threshold comparison.
    if meets_min_tier(verdict, min_tier_rank=req.min_tier_rank):
        return Outcome.SATISFIED
    return Outcome.REFUSED


def evaluate_requirement(
    requirement: SubscriptionRequirement,
    verdicts: Mapping[str, SubscriptionVerdict],
) -> Outcome:
    """Compose ``requirement`` over ``verdicts`` keyed by provider.

    Commutative and associative in both modes: provider order in config is
    arbitrary and must not change the answer.
    """
    if not requirement.requirements:
        return Outcome.SATISFIED

    outcomes = [_evaluate_one(req, verdicts.get(req.provider)) for req in requirement.requirements]

    if requirement.mode == MODE_ALL:
        # Kleene AND: F dominates, then U.
        if any(outcome is Outcome.REFUSED for outcome in outcomes):
            return Outcome.REFUSED
        if any(outcome is Outcome.UNDETERMINED for outcome in outcomes):
            return Outcome.UNDETERMINED
        return Outcome.SATISFIED

    # Kleene OR: T dominates, then U.
    if any(outcome is Outcome.SATISFIED for outcome in outcomes):
        return Outcome.SATISFIED
    if any(outcome is Outcome.UNDETERMINED for outcome in outcomes):
        return Outcome.UNDETERMINED
    return Outcome.REFUSED


def parse_requirement(blob: dict[str, Any] | None) -> SubscriptionRequirement:
    """Read ``subscription_requirement_json`` into a validated requirement.

    Malformed rows are skipped rather than raising: a bad config row must not 500
    the check-in endpoint. An unknown ``mode``, however, IS an error — silently
    picking a mode would change the admission rule.
    """
    blob = blob or {}
    mode = str(blob.get("mode") or MODE_ALL)
    if mode not in _MODES:
        raise ValueError(f"Unsupported subscription requirement mode: {mode!r}")

    # Deduplicate by provider, keeping the strictest threshold, so a duplicated
    # config row cannot accidentally loosen the rule.
    strictest: dict[str, int] = {}
    for row in blob.get("requirements") or []:
        provider = str(row.get("provider") or "").strip()
        if not provider:
            continue
        try:
            min_tier_rank = int(row.get("min_tier_rank", 1))
        except (TypeError, ValueError):
            min_tier_rank = 1
        min_tier_rank = max(min_tier_rank, 1)
        strictest[provider] = max(strictest.get(provider, 0), min_tier_rank)

    return SubscriptionRequirement(
        mode=mode,  # type: ignore[arg-type]
        requirements=tuple(
            ProviderRequirement(provider=provider, min_tier_rank=min_tier_rank)
            for provider, min_tier_rank in strictest.items()
        ),
    )
