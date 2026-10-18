import { lazy } from "react";

import type { AdminSlot, DisciplineUI } from "../types";

/** Overwatch's admin-only renderers (native-rank editor, collector rank mapping). */
const overwatch: DisciplineUI<AdminSlot> = {
  code: "overwatch",
  slots: {
    nativeRankEditor: lazy(() => import("./ladder/OwRangePicker")),
    rankMapping: lazy(() => import("./ladder/RankMappingPanel"))
  }
};

export default overwatch;
