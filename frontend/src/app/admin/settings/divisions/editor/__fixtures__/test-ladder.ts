import { TEST_LADDER_TIERS } from "@/test/native-ladder";

import { createLadder } from "../draftReducer";

export { TEST_LADDER_TIERS };

/** The editor's ladder over the shared 45-rank test ladder (`@/test/native-ladder`). */
export const TEST_LADDER = createLadder(TEST_LADDER_TIERS)!;
