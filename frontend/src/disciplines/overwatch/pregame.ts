import { lazy } from "react";

import type { DisciplineUI, PregameSlot } from "../types";

/** Overwatch's pre-game room renderers (lazy identity created once at module top level). */
const overwatch: DisciplineUI<PregameSlot> = {
  code: "overwatch",
  slots: { pregameCharacterBans: lazy(() => import("./pregame/PregameCharacterBans")) }
};

export default overwatch;
