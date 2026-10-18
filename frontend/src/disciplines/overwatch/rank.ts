import { lazy } from "react";

import type { DisciplineUI, RankSlot } from "../types";

/** Overwatch's rank-history renderer (lazy identity created once at module top level). */
const overwatch: DisciplineUI<RankSlot> = {
  code: "overwatch",
  slots: { rankHistory: lazy(() => import("./rankHistory/RankHistory")) }
};

export default overwatch;
