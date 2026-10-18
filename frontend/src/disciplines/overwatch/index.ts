import { lazy } from "react";

import type { DisciplineUI } from "../types";

/**
 * The Overwatch module's renderer slots. Lazy components are created once at module top level so their
 * identities are stable across renders. Roles, stat definitions and selections are native metadata, not
 * registry entries.
 */
const overwatch: DisciplineUI = {
  code: "overwatch",
  slots: {
    nativeRankEditor: lazy(() => import("./ladder/OwRangePicker")),
    rankHistory: lazy(() => import("./rankHistory/RankHistory")),
    rankMapping: lazy(() => import("./ladder/RankMappingPanel"))
  }
};

export default overwatch;
