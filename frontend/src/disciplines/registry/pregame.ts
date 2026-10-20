"use client";

import type { PregameSlot } from "../types";
import { createDisciplineLoader } from "./create";

/** Pre-game room slots (tournament web zone). Z7: the only importer of these entrypoints. */
export const loadPregameUI = createDisciplineLoader<PregameSlot>({
  overwatch: () => import("../overwatch/pregame"),
  lol: () => import("../lol/pregame")
});
