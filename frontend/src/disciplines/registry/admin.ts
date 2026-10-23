"use client";

import type { AdminSlot } from "../types";
import { createDisciplineLoader } from "./create";

/** Admin-only slots (division editor, collector settings): never reachable from a public host. Z7. */
export const loadAdminUI = createDisciplineLoader<AdminSlot>({
  overwatch: () => import("../overwatch/admin")
});
