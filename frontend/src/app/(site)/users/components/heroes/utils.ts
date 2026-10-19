import type { Formatter } from "@/lib/datetime";

import { LogStatsName } from "@/types/stats.types";
import type { CharacterStat, CharacterWithUserStats } from "@/types/user.types";

/** Only `number` is needed here; `useFormatter()` and `await getFormatter()` both satisfy it. */
export type NumberFormatter = Pick<Formatter, "number">;

const STAT_NUMBER_OPTIONS = { maximumFractionDigits: 2 } as const;

export const formatStatValue = (format: NumberFormatter, name: string, value: number) => {
  if (!Number.isFinite(value)) {
    return "-";
  }

  if (name.includes("accuracy")) {
    if (value > 1) return "-";
    return `${(value * 100).toFixed(2)}%`;
  }

  if (Math.abs(value) >= 1000) {
    return format.number(Math.round(value), STAT_NUMBER_OPTIONS);
  }
  return format.number(value, STAT_NUMBER_OPTIONS);
};

export const isRevertedStat = (name: string) => {
  return [
    LogStatsName.Deaths,
    LogStatsName.DamageTaken,
    LogStatsName.EnvironmentalDeaths
  ].includes(name as LogStatsName);
};

export const computeDelta = (userAvg: number, globalAvg: number, reversed: boolean) => {
  if (!Number.isFinite(userAvg) || !Number.isFinite(globalAvg) || globalAvg <= 0) {
    return null;
  }
  const raw = reversed ? (globalAvg - userAvg) / globalAvg : (userAvg - globalAvg) / globalAvg;
  if (!Number.isFinite(raw)) return null;
  return raw;
};

export const formatDelta = (delta: number) => {
  const sign = delta > 0 ? "+" : "";
  return `${sign}${(delta * 100).toFixed(0)}%`;
};

export const getOverall = (row: CharacterWithUserStats, name: LogStatsName) => {
  return row.stats.find((s) => s.name === name)?.overall ?? 0;
};

// Winrate can arrive as a 0..1 fraction or an already-scaled percent; normalize
// to a fraction the same way the Heroes tab does.
export const toFraction = (value: number | null | undefined): number | null => {
  if (value == null || !Number.isFinite(value)) return null;
  return value <= 1 ? value : value / 100;
};


export const statAvg10 = (stats: CharacterStat[], name: LogStatsName): number | null => {
  const stat = stats.find((s) => s.name === name);
  return stat && Number.isFinite(stat.avg_10) ? stat.avg_10 : null;
};
