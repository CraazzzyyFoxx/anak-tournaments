from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import sqlalchemy as sa


@dataclass(frozen=True)
class DivisionTier:
    number: int
    name: str
    rank_min: int
    rank_max: int | None
    icon_path: str


@dataclass(frozen=True)
class DivisionGrid:
    tiers: tuple[DivisionTier, ...]

    def resolve_division(self, rank: int) -> DivisionTier:
        for tier in self.tiers:
            if tier.rank_max is None:
                if rank >= tier.rank_min:
                    return tier
            elif tier.rank_min <= rank <= tier.rank_max:
                return tier
        return self.tiers[-1]

    def resolve_division_number(self, rank: int) -> int:
        return self.resolve_division(rank).number

    def resolve_rank_from_division(self, division_number: int) -> int | None:
        for tier in self.tiers:
            if tier.number == division_number:
                if tier.rank_max is None:
                    return tier.rank_min
                return (tier.rank_min + tier.rank_max) // 2
        return None

    @property
    def max_division(self) -> int:
        return max(t.number for t in self.tiers)

    @property
    def min_division(self) -> int:
        return min(t.number for t in self.tiers)

    @staticmethod
    def from_json(raw: dict[str, Any] | None) -> DivisionGrid:
        if raw is None:
            return DEFAULT_GRID

        tiers_data = raw.get("tiers")
        if not tiers_data:
            return DEFAULT_GRID

        tiers = []
        for t in tiers_data:
            tiers.append(
                DivisionTier(
                    number=int(t["number"]),
                    name=str(t["name"]),
                    rank_min=int(t["rank_min"]),
                    rank_max=int(t["rank_max"]) if t.get("rank_max") is not None else None,
                    icon_path=str(t["icon_path"]),
                )
            )

        tiers.sort(key=lambda tier: tier.rank_min, reverse=True)
        return DivisionGrid(tiers=tuple(tiers))

    def to_json(self) -> dict[str, Any]:
        return {
            "tiers": [
                {
                    "number": t.number,
                    "name": t.name,
                    "rank_min": t.rank_min,
                    "rank_max": t.rank_max,
                    "icon_path": t.icon_path,
                }
                for t in self.tiers
            ]
        }


def _build_default_grid() -> DivisionGrid:
    tiers = []
    for div_num in range(20, 0, -1):
        if div_num == 1:
            rank_min = 2000
            rank_max = None
        else:
            rank_min = (20 - div_num) * 100
            rank_max = rank_min + 99

        tiers.append(
            DivisionTier(
                number=div_num,
                name=f"Division {div_num}",
                rank_min=rank_min,
                rank_max=rank_max,
                icon_path=f"/divisions/{div_num}.png",
            )
        )

    tiers.sort(key=lambda t: t.rank_min, reverse=True)
    return DivisionGrid(tiers=tuple(tiers))


DEFAULT_GRID: DivisionGrid = _build_default_grid()


def resolve_grid(
    workspace_grid_json: dict[str, Any] | None,
    tournament_grid_json: dict[str, Any] | None = None,
) -> DivisionGrid:
    if tournament_grid_json is not None:
        return DivisionGrid.from_json(tournament_grid_json)
    if workspace_grid_json is not None:
        return DivisionGrid.from_json(workspace_grid_json)
    return DEFAULT_GRID


def division_case_expr(
    rank_column: sa.ColumnElement[int],
    grid: DivisionGrid,
) -> sa.Case:
    whens: list[tuple[sa.ColumnElement[bool], int]] = []
    for tier in grid.tiers:
        if tier.rank_max is None:
            condition = rank_column >= tier.rank_min
        else:
            condition = sa.and_(rank_column >= tier.rank_min, rank_column <= tier.rank_max)
        whens.append((condition, tier.number))

    return sa.case(*whens, else_=grid.tiers[-1].number)
