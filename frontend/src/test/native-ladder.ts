import { LADDER_TIERS, OW_DIVISIONS_DESC, TIER_NUMBERS } from "@/disciplines/overwatch/ladder/ow-ladder";
import type { NativeTier } from "@/types/discipline.types";

/**
 * A 45-rank native ladder (9 divisions × 5 tiers, 500 … 4900), the shape a native-ladder discipline
 * serves as `metadata.native_ladder`. Sourced from the Overwatch module's committed ladder artifact so
 * tests pin the same values production metadata carries. Test support may read a module's pure helpers;
 * runtime code outside `src/disciplines` may not (zone rule Z6).
 */
export const TEST_LADDER_TIERS: NativeTier[] = LADDER_TIERS.map((tier, index) => ({
  ...tier,
  native_division: OW_DIVISIONS_DESC[Math.floor(index / TIER_NUMBERS.length)],
  native_tier: TIER_NUMBERS[index % TIER_NUMBERS.length]
}));
