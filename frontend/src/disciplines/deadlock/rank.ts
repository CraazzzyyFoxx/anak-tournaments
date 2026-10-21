import { lazy } from "react";

import type { DisciplineUI, RankSlot } from "../types";

/** Deadlock's rank renderer: the current rank emblem and its history (lazy identity created once at module top). */
const deadlock: DisciplineUI<RankSlot> = {
  code: "deadlock",
  slots: { rankHistory: lazy(() => import("./rankHistory/RankHistory")) }
};

export default deadlock;
