import { LogStatsName } from "@/types/stats.types";
import { UserRoleType } from "@/types/user.types";

export const DIVISION_OPTIONS = Array.from({ length: 20 }, (_, index) => index + 1);

export const ROLE_FILTER_OPTIONS: Array<{ value: "all" | UserRoleType; label: string }> = [
  { value: "all", label: "All roles" },
  { value: "Tank", label: "Tank" },
  { value: "Damage", label: "Damage" },
  { value: "Support", label: "Support" }
];

export const HERO_COMPARE_STATS: LogStatsName[] = Object.values(LogStatsName).filter(
  (stat): stat is LogStatsName => stat !== LogStatsName.HeroTimePlayed && stat !== LogStatsName.Winrate
);
