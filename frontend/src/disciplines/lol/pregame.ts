import { lazy } from "react";

import type { DisciplineUI, PregameSlot } from "../types";

/** League of Legends' pre-game room renderers (lazy identity created once at module top level). */
const lol: DisciplineUI<PregameSlot> = {
  code: "lol",
  slots: { pregameCharacterBans: lazy(() => import("@/components/pick-ban/CharacterBansBoard")) }
};

export default lol;
