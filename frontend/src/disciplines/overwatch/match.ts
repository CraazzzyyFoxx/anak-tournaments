import { lazy } from "react";

import type { DisciplineUI, MatchSlot } from "../types";

/** Overwatch's match renderers (lazy identities created once at module top level). */
const overwatch: DisciplineUI<MatchSlot> = {
  code: "overwatch",
  slots: {
    matchStats: lazy(() => import("./match/MatchStats")),
    seriesStats: lazy(() => import("./match/SeriesStats")),
    matchRowBadge: lazy(() => import("./match/MvpOrdinal")),
    matchCharacters: lazy(() => import("./match/MatchCharacters"))
  }
};

export default overwatch;
