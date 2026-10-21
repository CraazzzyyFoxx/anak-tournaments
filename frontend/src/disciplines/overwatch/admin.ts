import { lazy } from "react";

import type { AdminSlot, DisciplineUI } from "../types";

/** Overwatch's admin-only renderers (native-rank editor). */
const overwatch: DisciplineUI<AdminSlot> = {
  code: "overwatch",
  slots: {
    nativeRankEditor: lazy(() => import("./ladder/OwRangePicker"))
  }
};

export default overwatch;
