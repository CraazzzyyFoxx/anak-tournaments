"""How a stage turns assigned teams into engine seed order.

The bracket engine treats ``team_ids[0]`` as seed 1 (plays the lowest seed).
This module is the only place that decides that order.

``seed_ranking`` lives in ``Stage.settings_json`` (same bag as ``best_of``):

- ``slot`` (default): keep StageItemInput slot order — standings wiring,
  manual slots, and every existing tournament stay unchanged.
- ``avg_sr``: highest ``Team.avg_sr`` is seed 1.
- ``total_sr``: highest ``Team.total_sr`` is seed 1.
- ``random``: ``random.Random(stage.id)`` shuffle, stable across processes.
"""

from __future__ import annotations

import random
from collections.abc import Mapping, Sequence
from dataclasses import replace
from enum import StrEnum
from typing import Any, Protocol

from shared.core import enums
from shared.services.bracket.types import BracketSkeleton

__all__ = (
    "SeedRanking",
    "advance_split",
    "apply_seed_ranking",
    "bracket_seeds",
    "collect_item_team_ids",
    "lower_bracket_item",
    "parse_seed_ranking",
    "rank_team_ids",
    "resolve_seeds",
)


class SeedRanking(StrEnum):
    SLOT = "slot"
    AVG_SR = "avg_sr"
    TOTAL_SR = "total_sr"
    RANDOM = "random"


class RankableTeam(Protocol):
    id: int
    avg_sr: float | None
    total_sr: float | int | None


def parse_seed_ranking(settings_json: Any) -> SeedRanking:
    if not isinstance(settings_json, dict):
        return SeedRanking.SLOT
    raw = settings_json.get("seed_ranking")
    try:
        return SeedRanking(raw)
    except (TypeError, ValueError):
        return SeedRanking.SLOT


def rank_team_ids(
    teams: Sequence[RankableTeam],
    ranking: SeedRanking,
    *,
    rng_seed: int,
) -> list[int]:
    """Return team ids in engine seed order (index 0 = seed 1)."""
    items = list(teams)
    if ranking is SeedRanking.SLOT:
        return [team.id for team in items]
    if ranking is SeedRanking.AVG_SR:
        return [team.id for team in sorted(items, key=lambda team: (-(team.avg_sr or 0.0), team.id))]
    if ranking is SeedRanking.TOTAL_SR:
        return [team.id for team in sorted(items, key=lambda team: (-(team.total_sr or 0), team.id))]
    if ranking is SeedRanking.RANDOM:
        ids = [team.id for team in items]
        random.Random(rng_seed).shuffle(ids)
        return ids
    return [team.id for team in items]


def apply_seed_ranking(
    team_ids: list[int],
    teams_by_id: Mapping[int, RankableTeam],
    ranking: SeedRanking,
    *,
    rng_seed: int,
) -> list[int]:
    """Reorder ``team_ids`` by ``ranking``. Unknown or placeholder ids keep slot order."""
    if ranking is SeedRanking.SLOT or not team_ids:
        return list(team_ids)
    if any(team_id <= 0 or team_id not in teams_by_id for team_id in team_ids):
        return list(team_ids)
    return rank_team_ids([teams_by_id[team_id] for team_id in team_ids], ranking, rng_seed=rng_seed)


def lower_bracket_item(stage: Any, sorted_items: list) -> Any | None:
    """The stage item holding the separate Lower bracket, when the stage has one.

    A "single bracket" double elimination keeps the whole UB+LB structure in one
    item instead, and the engine builds its lower rounds internally.
    """
    if stage.stage_type != enums.StageType.DOUBLE_ELIMINATION:
        return None
    return next((item for item in sorted_items if item.type == enums.StageItemType.BRACKET_LOWER), None)


def collect_item_team_ids(item: Any) -> list[int]:
    return [inp.team_id for inp in sorted(item.inputs, key=lambda value: value.slot) if inp.team_id is not None]


def bracket_seeds(
    stage: Any,
    sorted_items: list,
    lb_item: Any | None,
    *,
    collect: Any = collect_item_team_ids,
) -> tuple[list[int], list[int]]:
    """The teams wired into ``stage``, split into upper vs lower starters."""
    if stage.stage_type == enums.StageType.DOUBLE_ELIMINATION and getattr(stage, "split_lower_bracket", False):
        if lb_item is not None:
            upper = [tid for item in sorted_items if item is not lb_item for tid in collect(item)]
            return upper, collect(lb_item)
        all_ids = [tid for item in sorted_items for tid in collect(item)]
        half = len(all_ids) // 2
        return all_ids[:half], all_ids[half:]
    return [tid for item in sorted_items for tid in collect(item)], []


def advance_split(stage: Any, advance: int) -> tuple[int, int]:
    """How many of each group's ``advance_count`` teams seed upper vs lower."""
    if (
        stage.stage_type == enums.StageType.DOUBLE_ELIMINATION
        and getattr(stage, "split_lower_bracket", False)
        and any(item.type == enums.StageItemType.BRACKET_LOWER for item in stage.items)
    ):
        lower = advance // 2
        return advance - lower, lower
    return advance, 0


def resolve_seeds(skeleton: BracketSkeleton, teams: dict[int, int]) -> BracketSkeleton:
    """Swap placeholder negative seed ids for the teams they stand for."""

    def team_for(seed: int | None) -> int | None:
        if seed is None or seed >= 0:
            return seed
        return teams.get(seed)

    return replace(
        skeleton,
        pairings=[
            replace(pairing, home_team_id=team_for(pairing.home_team_id), away_team_id=team_for(pairing.away_team_id))
            for pairing in skeleton.pairings
        ],
    )
