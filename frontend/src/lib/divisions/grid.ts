import type {
  DivisionGrid,
  DivisionGridVersion,
  DivisionTier,
  Workspace
} from "@/types/workspace.types";

export type DivisionGridLike = Pick<DivisionGrid, "tiers"> | Pick<DivisionGridVersion, "tiers">;

type WorkspaceGrids = Pick<
  Workspace,
  "default_division_grid_versions" | "effective_division_grid_versions"
>;

/**
 * The grid ranks of one discipline resolve through for this workspace: the real resolved version (explicit
 * active choice or that game's validated system/native fallback), or `null` when the workspace is not loaded
 * or the game has none. Never another game's entry and never a built-in artwork set: callers render a neutral
 * missing state for `null`.
 */
export function resolveOwnerGrid(
  workspace: Pick<WorkspaceGrids, "effective_division_grid_versions"> | null | undefined,
  discipline: string | null | undefined
): DivisionGridVersion | null {
  const versions = workspace?.effective_division_grid_versions;
  if (!versions || !discipline || !Object.hasOwn(versions, discipline)) return null;
  return versions[discipline] ?? null;
}

/**
 * The version a workspace explicitly activated for one discipline; `null` when it runs on that game's system
 * fallback. The map is keyed by discipline — never read its first value.
 */
export function activeGridVersionId(
  workspace: Pick<WorkspaceGrids, "default_division_grid_versions"> | null | undefined,
  discipline: string | null | undefined
): number | null {
  const ids = workspace?.default_division_grid_versions;
  if (!ids || !discipline || !Object.hasOwn(ids, discipline)) return null;
  return ids[discipline] ?? null;
}

export function sortTiersAscending(grid: DivisionGridLike): DivisionTier[] {
  return [...grid.tiers].sort((left, right) => left.rank_min - right.rank_min);
}

export function sortTiersDescending(grid: DivisionGridLike): DivisionTier[] {
  return [...grid.tiers].sort((left, right) => right.rank_min - left.rank_min);
}

function getTierByDivision(
  grid: DivisionGridLike,
  division: number | null | undefined
): DivisionTier | null {
  if (division == null) {
    return null;
  }

  return grid.tiers.find((tier) => tier.number === division) ?? null;
}

export function getTierForRank(
  grid: DivisionGridLike,
  rank: number | null | undefined
): DivisionTier | null {
  if (rank == null) {
    return null;
  }

  for (const tier of grid.tiers) {
    if (tier.rank_max == null) {
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
  rank: number | null | undefined
): number | null {
  return getTierForRank(grid, rank)?.number ?? null;
}

/**
 * The `rank_value` representing a division — its tier floor. A division is a band, so
 * the floor is the canonical point (matches the backend `resolve_rank_for_division`, the
 * grid normalizer and the rank slider). A band midpoint produced off-grid values such as
 * 4449 for Grandmaster 1 (4400..4499).
 */
export function resolveRankFromDivision(
  grid: DivisionGridLike,
  division: number | null | undefined
): number | null {
  return getTierByDivision(grid, division)?.rank_min ?? null;
}

export function getDivisionOptions(grid: DivisionGridLike): number[] {
  return [...grid.tiers]
    .sort((left, right) => left.number - right.number)
    .map((tier) => tier.number);
}

export function clampDivisionToGrid(
  grid: DivisionGridLike,
  division: number | null | undefined
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
  division: number | null | undefined
): string | null {
  if (division == null) {
    return null;
  }

  return getTierByDivision(grid, division)?.name ?? `Division ${division}`;
}

export function getDivisionIconSrc(
  grid: DivisionGridLike,
  division: number | null | undefined
): string | null {
  if (division == null) {
    return null;
  }

  const tier = getTierByDivision(grid, division);
  if (tier) {
    return tier.icon_url;
  }

  return null;
}
