from __future__ import annotations

import functools
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

import sqlalchemy as sa

from shared.disciplines import discipline, fallback_ladder
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
    native_rank_min: int | None = None
    native_rank_max: int | None = None


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

    def resolve_division_from_native_rank(self, native_rank: int) -> DivisionTier | None:
        """Find the tier whose native range (``native_rank_min``/``native_rank_max``) contains the value.

        The bounds are unordered: admins may enter a band high-to-low. When no tier carries an explicit native
        range, the value is assumed to already live on the grid's scale and resolves by ``rank_min``/``rank_max``.
        Once any tier is configured, unconfigured tiers stay unreachable and values outside every range return None.
        """
        configured = False
        for tier in self.tiers:
            if tier.native_rank_min is None or tier.native_rank_max is None:
                continue
            configured = True
            low = min(tier.native_rank_min, tier.native_rank_max)
            high = max(tier.native_rank_min, tier.native_rank_max)
            if low <= native_rank <= high:
                return tier
        if configured or not self.tiers:
            return None
        return self.resolve_division(native_rank)

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
                    native_rank_min=int(t.native_rank_min) if getattr(t, "native_rank_min", None) is not None else None,
                    native_rank_max=int(t.native_rank_max) if getattr(t, "native_rank_max", None) is not None else None,
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
    """The registry's fallback ladder, for reads that name no discipline.

    A discipline-scoped read never falls back to another game's ladder. Tiers are descending by rank, as in stored grids.
    """
    tiers = tuple(
        DivisionTier(
            id=None,
            slug=tier.slug,
            number=tier.number,
            name=tier.name,
            rank_min=tier.rank_min,
            rank_max=tier.rank_max,
            icon_url=tier.icon_url,
        )
        for tier in fallback_ladder()
    )
    return DivisionGrid(version_id=None, tiers=tiers)


DEFAULT_GRID: DivisionGrid = _build_default_grid()


@functools.cache
def ladder_grid(discipline_code: str) -> DivisionGrid | None:
    """The discipline's own native ladder, or no in-code grid for a game without one."""
    ladder = discipline(discipline_code).native_ladder
    if not ladder:
        return None
    if ladder is fallback_ladder():
        return DEFAULT_GRID
    return DivisionGrid(
        version_id=None,
        tiers=tuple(
            DivisionTier(
                id=None,
                slug=tier.slug,
                number=tier.number,
                name=tier.name,
                rank_min=tier.rank_min,
                rank_max=tier.rank_max,
                icon_url=tier.icon_url,
            )
            for tier in ladder
        ),
    )


def canonical_tier_number(tier: DivisionTier, source_grid: DivisionGrid, ladder: DivisionGrid) -> int:
    """``tier`` of ``source_grid`` as a division number on ``ladder`` (the game's native ladder).

    A tier with a native range lands on the ladder tier holding the range's midpoint; any other is placed
    proportionally by its position between the source grid's first and last division.
    """
    if tier.native_rank_min is not None and tier.native_rank_max is not None:
        low = min(int(tier.native_rank_min), int(tier.native_rank_max))
        high = max(int(tier.native_rank_min), int(tier.native_rank_max))
        return ladder.resolve_division((low + high) // 2).number

    n_min, n_max = source_grid.min_division, source_grid.max_division
    m_min, m_max = ladder.min_division, ladder.max_division
    if n_max <= n_min:
        return m_min
    frac = (tier.number - n_min) / (n_max - n_min)
    return int(round(m_min + frac * (m_max - m_min)))


def canonical_division_number(source_grid: DivisionGrid, rank: int, ladder: DivisionGrid) -> int:
    """``rank`` on ``source_grid`` as a division number on ``ladder``."""
    return canonical_tier_number(source_grid.resolve_division(int(rank)), source_grid, ladder)


def stamp_canonical_numbers(tiers: Sequence[Any], discipline: str) -> None:
    """Set ``canonical_number`` on every tier of one grid version: its division on the game's native ladder.

    ``tiers`` is the version's full tier set (stored rows or look-alikes with ``number``/``rank_min``/``rank_max``/
    ``native_rank_min``/``native_rank_max``); a game without a native ladder stores ``None``.
    """
    ladder = ladder_grid(discipline)
    if ladder is None:
        for tier in tiers:
            tier.canonical_number = None
        return
    source = DivisionGrid(
        version_id=None,
        tiers=tuple(
            DivisionTier(
                id=None,
                slug=None,
                number=int(tier.number),
                name="",
                rank_min=int(tier.rank_min),
                rank_max=None if tier.rank_max is None else int(tier.rank_max),
                icon_url="",
                native_rank_min=None if tier.native_rank_min is None else int(tier.native_rank_min),
                native_rank_max=None if tier.native_rank_max is None else int(tier.native_rank_max),
            )
            for tier in tiers
        ),
    )
    for tier, runtime in zip(tiers, source.tiers, strict=True):
        tier.canonical_number = canonical_tier_number(runtime, source, ladder)


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


def division_rank_bounds(
    grid: DivisionGrid,
    div_min: int | None,
    div_max: int | None,
) -> tuple[int | None, int | None] | None:
    """Translate a division-number filter into an equivalent, indexable ``rank`` range.

    ``division_case_expr`` maps ``rank`` to a tier ``number`` monotonically
    (higher rank -> lower number), so ``div_min <= division(rank) <= div_max`` is
    equivalent to a contiguous ``rank`` range. Filtering ``Player.rank`` by that
    range is index-friendly and avoids evaluating the N-branch CASE per row.

    Returns ``(rank_min, rank_max)`` where either bound may be ``None`` (unbounded):
    - ``rank_max is None`` when the selection includes the top, unbounded tier;
    - ``rank_min is None`` when the selection includes the floor tier, which is
      also the CASE's ``else_`` target — ranks below the grid floor map to it, so
      there is no lower bound.

    Returns ``None`` when equivalence cannot be guaranteed (custom/non-contiguous
    grid, floor tier is not the ``else_`` target, or no tier matches). Callers
    must fall back to :func:`division_case_expr` in that case.
    """
    if div_min is None and div_max is None:
        return None

    ordered = sorted(grid.tiers, key=lambda tier: tier.rank_min)
    if not ordered:
        return None

    # Equivalence requires: floor tier (lowest rank) == CASE else_ target,
    # exactly the top tier unbounded, and no gaps/overlaps between tiers.
    floor_tier = ordered[0]
    if grid.tiers[-1].number != floor_tier.number:
        return None
    if ordered[-1].rank_max is not None:
        return None
    for lower, upper in zip(ordered, ordered[1:], strict=False):
        if lower.rank_max is None or lower.rank_max + 1 != upper.rank_min:
            return None

    selected = [
        tier
        for tier in grid.tiers
        if (div_min is None or tier.number >= div_min) and (div_max is None or tier.number <= div_max)
    ]
    if not selected:
        return None

    includes_floor = any(tier.number == floor_tier.number for tier in selected)
    rank_min = None if includes_floor else min(tier.rank_min for tier in selected)
    rank_max = (
        None
        if any(tier.rank_max is None for tier in selected)
        else max(tier.rank_max for tier in selected if tier.rank_max is not None)
    )
    return rank_min, rank_max


def division_filter_predicates(
    rank_column: sa.ColumnElement[int],
    div_min: int | None,
    div_max: int | None,
    grid: DivisionGrid,
) -> list[sa.ColumnElement[bool]]:
    """Predicates for ``div_min <= division(rank) <= div_max``.

    Prefers a plain, index-friendly ``rank`` range (:func:`division_rank_bounds`)
    and falls back to the per-row :func:`division_case_expr` only when the grid
    can't be reduced to a contiguous range. Returns ``[]`` when both bounds are
    ``None`` (no division constraint).
    """
    if div_min is None and div_max is None:
        return []

    bounds = division_rank_bounds(grid, div_min, div_max)
    if bounds is None:
        div_expr = division_case_expr(rank_column, grid)
        preds: list[sa.ColumnElement[bool]] = []
        if div_min is not None:
            preds.append(div_expr >= div_min)
        if div_max is not None:
            preds.append(div_expr <= div_max)
        return preds

    rank_min, rank_max = bounds
    preds = []
    if rank_min is not None:
        preds.append(rank_column >= rank_min)
    if rank_max is not None:
        preds.append(rank_column <= rank_max)
    return preds


def normalize_native_ranks_to_grid(
    raw_by_user: Mapping[int, Mapping[str, int]],
    grid: DivisionGrid,
) -> dict[int, dict[str, int]]:
    """Place native ranks on ``grid``: each becomes the ``rank_min`` of the tier whose native range holds it.

    A value outside every configured tier is dropped, so callers leave it ``None`` and compute no spurious delta.
    """
    out: dict[int, dict[str, int]] = {}
    for user_id, by_role in raw_by_user.items():
        for role, native_rank in by_role.items():
            tier = grid.resolve_division_from_native_rank(native_rank)
            if tier is not None:
                out.setdefault(user_id, {})[role] = tier.rank_min
    return out
