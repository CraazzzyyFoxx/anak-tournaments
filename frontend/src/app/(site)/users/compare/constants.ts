import { LogStatsName } from "@/types/stats.types";
import { UserRoleType } from "@/types/user.types";

export type RoleFilterLabelKey =
  | "common.roles.tank"
  | "common.roles.damage"
  | "common.roles.support"
  | "common.roles.flex";

export const ROLE_FILTER_OPTIONS: Array<{
  value: UserRoleType;
  labelKey: RoleFilterLabelKey;
}> = [
  { value: "Tank", labelKey: "common.roles.tank" },
  { value: "Damage", labelKey: "common.roles.damage" },
  { value: "Support", labelKey: "common.roles.support" },
  { value: "Flex", labelKey: "common.roles.flex" }
];

export const HERO_COMPARE_STATS: LogStatsName[] = Object.values(LogStatsName).filter(
  (stat): stat is LogStatsName => stat !== LogStatsName.HeroTimePlayed && stat !== LogStatsName.Winrate
);
