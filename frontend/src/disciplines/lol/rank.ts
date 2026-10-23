import { lazy } from "react";

import type { DisciplineUI, RankSlot } from "../types";

/** League's rank renderer: the shared view, a line per queue (lazy identity created once at module top). */
const lol: DisciplineUI<RankSlot> = {
  code: "lol",
  slots: { rankHistory: lazy(() => import("@/components/rank/RankHistoryView")) }
};

export default lol;
