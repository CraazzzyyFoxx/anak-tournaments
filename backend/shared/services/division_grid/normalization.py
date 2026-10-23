from __future__ import annotations

from dataclasses import dataclass
from typing import overload

from shared.division_grid import DivisionGrid, DivisionTier


class DivisionGridNormalizationError(RuntimeError):
    pass


@dataclass(frozen=True)
class DivisionGridNormalizer:
    target_version_id: int
    target_grid: DivisionGrid
    source_grids_by_version_id: dict[int, DivisionGrid]
    primary_target_by_source_tier_id: dict[int, DivisionTier]

    @overload
    def normalize_division(self, source_version_id: int, rank: int) -> DivisionTier: ...
    @overload
    def normalize_division(self, source_version_id: int, rank: int | None) -> DivisionTier | None: ...
    def normalize_division(self, source_version_id: int, rank: int | None) -> DivisionTier | None:
        """``rank`` on its source version mapped onto the target grid; no rank (NULL) has no division."""
        if rank is None:
            return None
        if source_version_id == self.target_version_id:
            return self.target_grid.resolve_division(rank)

        source_grid = self.source_grids_by_version_id.get(source_version_id)
        if source_grid is None:
            raise DivisionGridNormalizationError(f"Normalization source version {source_version_id} is not loaded")

        source_tier = source_grid.resolve_division(rank)
        if source_tier.id is None:
            raise DivisionGridNormalizationError(f"Source tier id is missing for version {source_version_id}")

        target_tier = self.primary_target_by_source_tier_id.get(source_tier.id)
        if target_tier is None:
            raise DivisionGridNormalizationError(f"Primary mapping is missing for source tier {source_tier.id}")
        return target_tier

    def normalize_division_number(self, source_version_id: int, rank: int) -> int:
        return self.normalize_division(source_version_id, rank).number
