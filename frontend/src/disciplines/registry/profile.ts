"use client";

import type { ProfileSlot } from "../types";
import { createDisciplineLoader } from "./create";

/** Player-profile slots: characters tab, overview cards, hover cards, dossier cells. Z7: the only importer of these entrypoints. */
export const loadProfileUI = createDisciplineLoader<ProfileSlot>({
  overwatch: () => import("../overwatch/profile")
});
