import { lazy } from "react";

import type { DisciplineUI, RankSlot } from "../types";
// The rank-history lines are drawn in this module's own role hues (`--aqt-tank/-damage/-support`).
import "./role-hues.css";

/** Overwatch's rank-history renderer: the shared view (lazy identity created once at module top level). */
const overwatch: DisciplineUI<RankSlot> = {
  code: "overwatch",
  slots: { rankHistory: lazy(() => import("@/components/rank/RankHistoryView")) }
};

export default overwatch;
