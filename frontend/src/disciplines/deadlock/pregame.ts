import { lazy } from "react";

import type { DisciplineUI, PregameSlot } from "../types";

/** Deadlock's pre-game room renderers: the hero bans per team (lazy identity created once at module top level). */
const deadlock: DisciplineUI<PregameSlot> = {
  code: "deadlock",
  slots: { pregameCharacterBans: lazy(() => import("@/components/pick-ban/CharacterBansBoard")) }
};

export default deadlock;
