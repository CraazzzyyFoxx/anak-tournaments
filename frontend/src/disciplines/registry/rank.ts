"use client";

import type { RankSlot } from "../types";
import { createDisciplineLoader } from "./create";

/** Rank-history slots (public profile, people sheets, balancer). Z7: the only importer of these entrypoints. */
export const loadRankUI = createDisciplineLoader<RankSlot>({
  overwatch: () => import("../overwatch/rank"),
  lol: () => import("../lol/rank")
});
