import type {
  DivisionGrid,
  DivisionGridVersion,
  DivisionTier,
} from "@/types/workspace.types";

type DivisionGridLike = Pick<DivisionGrid, "tiers"> | Pick<DivisionGridVersion, "tiers">;

const DEFAULT_DIVISION_ICON_BASE =
  "https://minio.craazzzyyfoxx.me/aqt/assets/divisions";

const DEFAULT_DIVISION_GRID_TIERS: DivisionTier[] = Array.from({ length: 20 }, (_, index) => {
  const number = index + 1;
  return {
    number,
    name: `Division ${number}`,
    rank_min: number === 1 ? 2000 : (20 - number) * 100,
    rank_max: number === 1 ? null : (20 - number) * 100 + 99,
    icon_url: `${DEFAULT_DIVISION_ICON_BASE}/default-${number}.png`,
  };
}).sort((left, right) => right.rank_min - left.rank_min);

export const DEFAULT_DIVISION_GRID: DivisionGrid = {
  tiers: DEFAULT_DIVISION_GRID_TIERS,
};

export function getDefaultDivisionGrid(): DivisionGrid {
  return DEFAULT_DIVISION_GRID;
}

export function sortTiersAscending(grid: DivisionGridLike): DivisionTier[] {
  return [...grid.tiers].sort((left, right) => left.rank_min - right.rank_min);
}

export function sortTiersDescending(grid: DivisionGridLike): DivisionTier[] {
  return [...grid.tiers].sort((left, right) => right.rank_min - left.rank_min);
}

export function getTierByDivision(
  grid: DivisionGridLike,
  division: number | null | undefined,
): DivisionTier | null {
  if (division == null) {
    return null;
  }

  return grid.tiers.find((tier) => tier.number === division) ?? null;
}

export function getTierForRank(
  grid: DivisionGridLike,
  rank: number | null | undefined,
): DivisionTier | null {
  if (rank == null) {
    return null;
  }

  for (const tier of grid.tiers) {
    if (tier.rank_max === null) {
      if (rank >= tier.rank_min) {
        return tier;
      }
      continue;
    }

    if (rank >= tier.rank_min && rank <= tier.rank_max) {
      return tier;
    }
  }

  return grid.tiers.at(-1) ?? null;
}

export function resolveDivisionFromRank(
  grid: DivisionGridLike,
  rank: number | null | undefined,
): number | null {
  return getTierForRank(grid, rank)?.number ?? null;
}

export function resolveRankFromDivision(
  grid: DivisionGridLike,
  division: number | null | undefined,
): number | null {
  const tier = getTierByDivision(grid, division);
  if (!tier) {
    return null;
  }

  if (tier.rank_max === null) {
    return tier.rank_min;
  }

  return Math.floor((tier.rank_min + tier.rank_max) / 2);
}

export function getDivisionOptions(grid: DivisionGridLike): number[] {
  return [...grid.tiers].sort((left, right) => left.number - right.number).map((tier) => tier.number);
}

export function clampDivisionToGrid(
  grid: DivisionGridLike,
  division: number | null | undefined,
): number | undefined {
  if (division == null) {
    return undefined;
  }

  const divisionOptions = getDivisionOptions(grid);
  if (divisionOptions.length === 0) {
    return undefined;
  }

  const minDivision = divisionOptions[0];
  const maxDivision = divisionOptions.at(-1) ?? minDivision;
  return Math.min(Math.max(division, minDivision), maxDivision);
}

export function getDivisionLabel(
  grid: DivisionGridLike,
  division: number | null | undefined,
): string | null {
  if (division == null) {
    return null;
  }

  return getTierByDivision(grid, division)?.name ?? `Division ${division}`;
}

export function getDivisionIconSrc(
  grid: DivisionGridLike,
  division: number | null | undefined,
): string | null {
  if (division == null) {
    return null;
  }

  return (
    getTierByDivision(grid, division)?.icon_url ??
    `${DEFAULT_DIVISION_ICON_BASE}/default-${division}.png`
  );
}
