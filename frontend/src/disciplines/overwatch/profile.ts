import { lazy } from "react";

import type { DisciplineUI, ProfileSlot } from "../types";

/** Overwatch's player-profile renderers (lazy identities created once at module top level). */
const overwatch: DisciplineUI<ProfileSlot> = {
  code: "overwatch",
  slots: {
    characterPopover: lazy(() => import("./character/HeroUserStatsPopover")),
    characterStats: lazy(() => import("./character/HeroesView")),
    topCharacters: lazy(() => import("./character/TopHeroesTable")),
    roleSignatures: lazy(() => import("./character/RoleSignatures")),
    tournamentSummary: lazy(() => import("./character/AvgMvpCell"))
  }
};

export default overwatch;
