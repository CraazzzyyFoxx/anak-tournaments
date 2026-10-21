import { lazy } from "react";

import type { DisciplineUI, RankSlot } from "../types";

/** League's rank renderer: current Solo/Duo and Flex, and their history (lazy identity created once at module top). */
const lol: DisciplineUI<RankSlot> = {
  code: "lol",
  slots: { rankHistory: lazy(() => import("./rankHistory/RankHistory")) }
};

export default lol;
