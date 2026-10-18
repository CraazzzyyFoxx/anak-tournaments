import { LADDER_TIERS, OW_DIVISIONS_DESC, TIER_NUMBERS } from "@/disciplines/overwatch/ladder/ow-ladder";
import type { NativeTier } from "@/types/discipline.types";

import { createLadder } from "../draftReducer";

/**
 * A 45-rank native ladder (9 divisions × 5 tiers, 500 … 4900), the shape a native-ladder discipline
 * serves as `metadata.native_ladder`. Sourced from the committed ladder artifact so the editor tests
 * pin the same values production metadata carries.
 */
export const TEST_LADDER_TIERS: NativeTier[] = LADDER_TIERS.map((tier, index) => ({
  ...tier,
  native_division: OW_DIVISIONS_DESC[Math.floor(index / TIER_NUMBERS.length)],
  native_tier: TIER_NUMBERS[index % TIER_NUMBERS.length]
}));

export const TEST_LADDER = createLadder(TEST_LADDER_TIERS)!;
