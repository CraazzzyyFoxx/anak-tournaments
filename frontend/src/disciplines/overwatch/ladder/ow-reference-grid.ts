import type { DivisionGrid, DivisionTier } from "@/types/workspace.types";

import { LADDER_TIERS } from "./ow-ladder";

/**
 * The OW ladder as a grid, top tier first (already descending by `rank_min`, the order a stored grid
 * arrives in). `sort_order` is the tier's position.
 *
 * Use it only where the numbers on hand are on the **OW/SR scale**: OverFast snapshot `rank_value`s and the
 * `parser.rank_mapping` cells. It is NOT a fallback for a workspace grid: a missing grid is a neutral missing
 * state in every generic reader, never these crests.
 */
const OW_LADDER_TIERS: DivisionTier[] = LADDER_TIERS.map((tier, index) => ({
  slug: tier.slug,
  number: tier.number,
  name: tier.name,
  sort_order: index,
  rank_min: tier.rank_min,
  rank_max: tier.rank_max,
  icon_url: tier.icon_url
}));

export const OW_REFERENCE_GRID: DivisionGrid = { tiers: OW_LADDER_TIERS };
