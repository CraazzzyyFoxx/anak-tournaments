import { lazy } from "react";

import type { DisciplineUI, RankSlot } from "../types";

/** Deadlock's rank renderer: the shared view, a line per Steam account (lazy identity created once at module top). */
const deadlock: DisciplineUI<RankSlot> = {
  code: "deadlock",
  slots: { rankHistory: lazy(() => import("@/components/rank/RankHistoryView")) }
};

export default deadlock;
