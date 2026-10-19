import type { DisciplineDescriptor } from "@/types/discipline.types";

/** The two installed games as the catalog admin's descriptor reads them (OW has modes, LoL does not). */
export const OVERWATCH = {
  code: "overwatch",
  name: "Overwatch",
  enabled: true,
  kinds: { character: "Hero", map: "Map", mode: "Mode" },
  character_classes: ["tank", "damage", "support"],
} as unknown as DisciplineDescriptor;

export const LOL = {
  code: "lol",
  name: "League of Legends",
  enabled: true,
  kinds: { character: "Champion", map: "Map" },
  character_classes: ["Assassin", "Mage"],
} as unknown as DisciplineDescriptor;
