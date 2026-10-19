import { lazy } from "react";

import type { AnalyticsSlot, DisciplineUI } from "../types";

/** Overwatch's tournament analytics board (lazy identity created once at module top level). */
const overwatch: DisciplineUI<AnalyticsSlot> = {
  code: "overwatch",
  slots: {
    analytics: lazy(() => import("./analytics/AnalyticsBoard"))
  }
};

export default overwatch;
