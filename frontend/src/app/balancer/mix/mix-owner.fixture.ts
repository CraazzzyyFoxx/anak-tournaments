import { LOL_METADATA, OW_METADATA } from "@/test/discipline-metadata";
import type { RosterShape } from "@/lib/roster/shape";

import { buildMixOwner, type MixOwner } from "./pickup-lineup";

/** A mix's frozen roster shape as the server projects it (`roster_shape` on the single-mix read). */
function shapeOf(slots: Record<string, number>): RosterShape {
  const teamSize = Object.values(slots).reduce((sum, count) => sum + count, 0);
  const flex = slots.flex ?? 0;
  return {
    dimension: "x",
    slots,
    team_size: teamSize,
    flex_slots: flex,
    has_role_slots: flex < teamSize,
    draft_rounds: teamSize - 1,
    source: "custom_game",
  };
}

/** Overwatch's 1-2-2 format. */
export const OW_SHAPE: RosterShape = { ...shapeOf({ tank: 1, damage: 2, support: 2 }), dimension: "player_role" };

/** League's five positions, one each. */
export const LOL_SHAPE: RosterShape = {
  ...shapeOf({ top: 1, jungle: 1, mid: 1, bot: 1, support: 1 }),
  dimension: "position",
};

/** Test grids carry no tiers: the lineup only needs *a* grid object, crests are the grid tests' business. */
const EMPTY_GRID = { tiers: [] };

/** The Overwatch mix owner: three roles, demand 2/4/4, lobby of ten. */
export const OW_OWNER: MixOwner = buildMixOwner(OW_METADATA, OW_SHAPE, EMPTY_GRID);

/** The League mix owner: five positions, demand 2 each, lobby of ten. */
export const LOL_OWNER: MixOwner = buildMixOwner(LOL_METADATA, LOL_SHAPE, EMPTY_GRID);

/** An Overwatch mix whose format is a role-less flex roster: no role asks for a seat. */
export function flexOnlyOwner(): MixOwner {
  return buildMixOwner(OW_METADATA, { ...shapeOf({ flex: 5 }), dimension: "player_role" }, EMPTY_GRID);
}
