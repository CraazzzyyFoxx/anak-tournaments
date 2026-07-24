"""Hybrid auto-mapping rule generator for division grid versions.

Given the tiers of a *source* version and a *target* version, produce the
``DivisionGridMappingRuleWrite`` rules that map every source tier onto one or
more target tiers, plus the list of source tiers that could not be mapped
(conflicts) and require manual resolution.

Strategy, per source tier:
  1. slug identity  — a target tier with the same ``slug`` wins (weight 1.0).
  2. rank overlap   — otherwise, distribute weight across target tiers by the
                      overlap of their inclusive rank ranges; the largest
                      overlap becomes the primary rule.
  3. conflict       — neither slug match nor any positive overlap.

This is a pure function (no DB, no I/O) so it is trivially testable and reused
by both the save orchestration and the marketplace/portable importers.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from src import schemas


class TierLike(Protocol):
    id: int
    slug: str
    name: str
    rank_min: int
    rank_max: int | None


@dataclass(frozen=True)
class ConflictTier:
    source_tier_id: int
    slug: str
    name: str


@dataclass(frozen=True)
class MappingGeneration:
    rules: list[schemas.DivisionGridMappingRuleWrite] = field(default_factory=list)
    conflicts: list[ConflictTier] = field(default_factory=list)

    @property
    def is_complete(self) -> bool:
        return not self.conflicts


def _ceiling(source_tiers: list[TierLike], target_tiers: list[TierLike]) -> int:
    """A finite upper bound strictly above every bound, used to give
    open-ended (``rank_max is None``) tiers a positive, comparable width."""
    bounds: list[int] = []
    for tier in (*source_tiers, *target_tiers):
        bounds.append(tier.rank_min)
        if tier.rank_max is not None:
            bounds.append(tier.rank_max)
    return (max(bounds) if bounds else 0) + 1


def _eff_max(tier: TierLike, ceiling: int) -> int:
    return tier.rank_max if tier.rank_max is not None else ceiling


def _overlap(source: TierLike, target: TierLike, ceiling: int) -> int:
    lo = max(source.rank_min, target.rank_min)
    hi = min(_eff_max(source, ceiling), _eff_max(target, ceiling))
    return hi - lo  # inclusive-range overlap magnitude; ratios only


def generate_mapping_rules(
    source_tiers: list[TierLike],
    target_tiers: list[TierLike],
) -> MappingGeneration:
    ceiling = _ceiling(source_tiers, target_tiers)
    target_by_slug = {tier.slug: tier for tier in target_tiers}

    rules: list[schemas.DivisionGridMappingRuleWrite] = []
    conflicts: list[ConflictTier] = []

    for source in source_tiers:
        # 1. slug identity
        exact = target_by_slug.get(source.slug)
        if exact is not None:
            rules.append(
                schemas.DivisionGridMappingRuleWrite(
                    source_tier_id=source.id,
                    target_tier_id=exact.id,
                    weight=1.0,
                    is_primary=True,
                )
            )
            continue

        # 2. rank overlap
        overlaps = [
            (target, _overlap(source, target, ceiling))
            for target in target_tiers
        ]
        overlaps = [(target, value) for target, value in overlaps if value > 0]

        if not overlaps:
            # 3. conflict
            conflicts.append(
                ConflictTier(source_tier_id=source.id, slug=source.slug, name=source.name)
            )
            continue

        overlaps.sort(key=lambda item: (item[1], item[0].id), reverse=True)
        primary_target = overlaps[0][0]

        if len(overlaps) == 1:
            rules.append(
                schemas.DivisionGridMappingRuleWrite(
                    source_tier_id=source.id,
                    target_tier_id=primary_target.id,
                    weight=1.0,
                    is_primary=True,
                )
            )
            continue

        total = sum(value for _, value in overlaps)
        secondary_rules: list[schemas.DivisionGridMappingRuleWrite] = []
        for target, value in overlaps[1:]:
            weight = round(value / total, 6)
            if weight <= 0:
                continue
            secondary_rules.append(
                schemas.DivisionGridMappingRuleWrite(
                    source_tier_id=source.id,
                    target_tier_id=target.id,
                    weight=weight,
                    is_primary=False,
                )
            )

        primary_weight = round(1.0 - sum(rule.weight for rule in secondary_rules), 6)
        rules.append(
            schemas.DivisionGridMappingRuleWrite(
                source_tier_id=source.id,
                target_tier_id=primary_target.id,
                weight=primary_weight,
                is_primary=True,
            )
        )
        rules.extend(secondary_rules)

    return MappingGeneration(rules=rules, conflicts=conflicts)
