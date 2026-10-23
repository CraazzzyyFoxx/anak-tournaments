"use client";

import type { AnalyticsSlot } from "../types";
import { createDisciplineLoader } from "./create";

/** The tournament analytics board (web zone, `/tournaments/analytics`). Z7: the only importer of these entrypoints. */
export const loadAnalyticsUI = createDisciplineLoader<AnalyticsSlot>({
  overwatch: () => import("../overwatch/analytics")
});
