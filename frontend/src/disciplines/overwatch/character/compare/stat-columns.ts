import { formatPercent } from "@/lib/format";
import type { CharacterLeaderboardEntry } from "@/types/statistics.types";

export type StatKey = string;

type StatLabelKey =
  | "users.heroesCompare.stat.elims"
  | "users.heroesCompare.stat.healing"
  | "users.heroesCompare.stat.damage"
  | "users.heroesCompare.stat.deaths"
  | "users.heroesCompare.stat.kd"
  | "users.heroesCompare.stat.kda"
  | "users.heroesCompare.stat.finalBlows"
  | "users.heroesCompare.stat.blocked"
  | "users.heroesCompare.stat.soloKills"
  | "users.heroesCompare.stat.objKills"
  | "users.heroesCompare.stat.defAssists"
  | "users.heroesCompare.stat.offAssists"
  | "users.heroesCompare.stat.allDmg"
  | "users.heroesCompare.stat.dmgTaken"
  | "users.heroesCompare.stat.selfHeal"
  | "users.heroesCompare.stat.ults"
  | "users.heroesCompare.stat.multikills"
  | "users.heroesCompare.stat.envKills"
  | "users.heroesCompare.stat.crits"
  | "users.heroesCompare.stat.weaponAcc"
  | "users.heroesCompare.stat.critAcc";

export interface StatColumnDef {
  key: StatKey;
  labelKey: StatLabelKey;
  /** Lower is better (deaths, damage taken): the natural order is ascending. */
  ascending: boolean;
  formatValue: (v: number) => string;
  getValue: (e: CharacterLeaderboardEntry) => number;
}

const _k =
  (field: keyof CharacterLeaderboardEntry) =>
  (e: CharacterLeaderboardEntry): number =>
    e[field] as number;

const _fmt = {
  count: (v: number) => v.toFixed(2),
  large: (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)),
  /** The API reports accuracy as a fraction (0.32), not as percent points. */
  pct:   (v: number) => formatPercent(v, 1),
  ratio: (v: number) => v.toFixed(2),
} as const;

export const COL: Record<string, StatColumnDef> = {
  per10_eliminations:      { key: "per10_eliminations",      labelKey: "users.heroesCompare.stat.elims",      ascending: false, formatValue: _fmt.count, getValue: _k("per10_eliminations") },
  per10_healing:           { key: "per10_healing",           labelKey: "users.heroesCompare.stat.healing",    ascending: false, formatValue: _fmt.large, getValue: _k("per10_healing") },
  per10_damage:            { key: "per10_damage",            labelKey: "users.heroesCompare.stat.damage",     ascending: false, formatValue: _fmt.large, getValue: _k("per10_damage") },
  per10_deaths:            { key: "per10_deaths",            labelKey: "users.heroesCompare.stat.deaths",     ascending: true,  formatValue: _fmt.count, getValue: _k("per10_deaths") },
  kd:                      { key: "kd",                      labelKey: "users.heroesCompare.stat.kd",         ascending: false, formatValue: _fmt.ratio, getValue: _k("kd") },
  kda:                     { key: "kda",                     labelKey: "users.heroesCompare.stat.kda",        ascending: false, formatValue: _fmt.ratio, getValue: _k("kda") },
  per10_final_blows:       { key: "per10_final_blows",       labelKey: "users.heroesCompare.stat.finalBlows", ascending: false, formatValue: _fmt.count, getValue: _k("per10_final_blows") },
  per10_damage_blocked:    { key: "per10_damage_blocked",    labelKey: "users.heroesCompare.stat.blocked",    ascending: false, formatValue: _fmt.large, getValue: _k("per10_damage_blocked") },
  per10_solo_kills:        { key: "per10_solo_kills",        labelKey: "users.heroesCompare.stat.soloKills",  ascending: false, formatValue: _fmt.count, getValue: _k("per10_solo_kills") },
  per10_obj_kills:         { key: "per10_obj_kills",         labelKey: "users.heroesCompare.stat.objKills",   ascending: false, formatValue: _fmt.count, getValue: _k("per10_obj_kills") },
  per10_defensive_assists: { key: "per10_defensive_assists", labelKey: "users.heroesCompare.stat.defAssists", ascending: false, formatValue: _fmt.count, getValue: _k("per10_defensive_assists") },
  per10_offensive_assists: { key: "per10_offensive_assists", labelKey: "users.heroesCompare.stat.offAssists", ascending: false, formatValue: _fmt.count, getValue: _k("per10_offensive_assists") },
  per10_all_damage:        { key: "per10_all_damage",        labelKey: "users.heroesCompare.stat.allDmg",     ascending: false, formatValue: _fmt.large, getValue: _k("per10_all_damage") },
  per10_damage_taken:      { key: "per10_damage_taken",      labelKey: "users.heroesCompare.stat.dmgTaken",   ascending: true,  formatValue: _fmt.large, getValue: _k("per10_damage_taken") },
  per10_self_healing:      { key: "per10_self_healing",      labelKey: "users.heroesCompare.stat.selfHeal",   ascending: false, formatValue: _fmt.large, getValue: _k("per10_self_healing") },
  per10_ultimates_used:    { key: "per10_ultimates_used",    labelKey: "users.heroesCompare.stat.ults",       ascending: false, formatValue: _fmt.count, getValue: _k("per10_ultimates_used") },
  per10_multikills:        { key: "per10_multikills",        labelKey: "users.heroesCompare.stat.multikills", ascending: false, formatValue: _fmt.count, getValue: _k("per10_multikills") },
  per10_env_kills:         { key: "per10_env_kills",         labelKey: "users.heroesCompare.stat.envKills",   ascending: false, formatValue: _fmt.count, getValue: _k("per10_env_kills") },
  per10_crit_hits:         { key: "per10_crit_hits",         labelKey: "users.heroesCompare.stat.crits",      ascending: false, formatValue: _fmt.count, getValue: _k("per10_crit_hits") },
  avg_weapon_accuracy:     { key: "avg_weapon_accuracy",     labelKey: "users.heroesCompare.stat.weaponAcc",  ascending: false, formatValue: _fmt.pct,   getValue: _k("avg_weapon_accuracy") },
  avg_crit_accuracy:       { key: "avg_crit_accuracy",       labelKey: "users.heroesCompare.stat.critAcc",    ascending: false, formatValue: _fmt.pct,   getValue: _k("avg_crit_accuracy") },
};

/** Keyed by the catalog's `attrs.class` code (`tank`, `damage`, `support`); the lookup ignores case. */
const FIXED_COLUMNS_BY_ROLE: Record<string, StatKey[]> = {
  damage:  ["per10_eliminations", "per10_damage", "per10_deaths", "kd"],
  tank:    ["per10_eliminations", "per10_damage_blocked", "per10_damage", "per10_deaths"],
  support: ["per10_eliminations", "per10_healing", "per10_damage", "per10_deaths"],
};

const FIXED_COLUMNS_DEFAULT: StatKey[] = [
  "per10_eliminations", "per10_healing", "per10_damage", "per10_deaths",
];

const DEFAULT_CUSTOM_BY_ROLE: Record<string, StatKey> = {
  damage:  "per10_final_blows",
  tank:    "per10_solo_kills",
  support: "per10_final_blows",
};

const DEFAULT_CUSTOM_KEY: StatKey = "per10_final_blows";

export const ALL_STAT_OPTIONS: StatColumnDef[] = Object.values(COL);

export const NUM_COLUMNS = 5;

export function getDefaultColumnKeys(role?: string | null): StatKey[] {
  const key = role?.toLowerCase() ?? "";
  const fixed = FIXED_COLUMNS_BY_ROLE[key] ?? FIXED_COLUMNS_DEFAULT;
  return [...fixed, DEFAULT_CUSTOM_BY_ROLE[key] ?? DEFAULT_CUSTOM_KEY];
}

/** The stat a class is judged by first: the board's default order and the headline's "top" figure. */
const SIGNATURE_BY_ROLE: Record<string, StatKey> = {
  support: "per10_healing",
  tank: "per10_damage_blocked",
};

export function getSignatureKey(role?: string | null): StatKey {
  return SIGNATURE_BY_ROLE[role?.toLowerCase() ?? ""] ?? "per10_damage";
}
