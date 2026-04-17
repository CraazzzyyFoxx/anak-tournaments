from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

import sqlalchemy as sa

from shared.domain import division_rank

if TYPE_CHECKING:
    from shared.models.division_grid import DivisionGridVersion


@dataclass(frozen=True)
class DivisionTier:
    id: int | None
    slug: str | None
    number: int
    name: str
    rank_min: int
    rank_max: int | None
    icon_url: str


@dataclass(frozen=True)
class DivisionGrid:
    version_id: int | None
    tiers: tuple[DivisionTier, ...]

    def resolve_division(self, rank: int) -> DivisionTier:
        return division_rank.resolve_tier_for_rank(self, rank)  # type: ignore[return-value]

    def resolve_division_number(self, rank: int) -> int:
        return division_rank.resolve_division_for_rank(self, rank)

    def resolve_rank_from_division(self, division_number: int) -> int | None:
        return division_rank.resolve_rank_for_division(self, division_number)

    @property
    def max_division(self) -> int:
        return max(t.number for t in self.tiers)

    @property
    def min_division(self) -> int:
        return min(t.number for t in self.tiers)

    @staticmethod
    def from_version(version: DivisionGridVersion | None) -> DivisionGrid:
        if version is None or not version.tiers:
            return DEFAULT_GRID

        tiers = []
        for t in version.tiers:
            tiers.append(
                DivisionTier(
                    id=t.id,
                    slug=t.slug,
                    number=int(t.number),
                    name=str(t.name),
                    rank_min=int(t.rank_min),
                    rank_max=int(t.rank_max) if t.rank_max is not None else None,
                    icon_url=str(t.icon_url),
                )
            )

        tiers.sort(key=lambda tier: tier.rank_min, reverse=True)
        return DivisionGrid(version_id=version.id, tiers=tuple(tiers))

    def to_json(self) -> dict[str, Any]:
        return {
            "tiers": [
                {
                    "id": t.id,
                    "slug": t.slug,
                    "number": t.number,
                    "name": t.name,
                    "rank_min": t.rank_min,
                    "rank_max": t.rank_max,
                    "icon_url": t.icon_url,
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
                id=None,
                slug=f"division-{div_num}",
                number=div_num,
                name=f"Division {div_num}",
                rank_min=rank_min,
                rank_max=rank_max,
                icon_url=f"https://minio.craazzzyyfoxx.me/aqt/assets/divisions/default-{div_num}.png",
            )
        )

    tiers.sort(key=lambda t: t.rank_min, reverse=True)
    return DivisionGrid(version_id=None, tiers=tuple(tiers))


DEFAULT_GRID: DivisionGrid = _build_default_grid()


def load_runtime_grid(
    version: DivisionGridVersion | None,
) -> DivisionGrid:
    return DivisionGrid.from_version(version)


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
