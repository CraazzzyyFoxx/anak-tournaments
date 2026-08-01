import { LogStatsName } from "@/types/stats.types";
import { HeroWithUserStats } from "@/types/hero.types";

const numberFmt = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2
});

export const formatPercent = (value: number, digits = 0) => {
  const safe = Number.isFinite(value) ? value : 0;
  return `${(safe * 100).toFixed(digits)}%`;
};

export const formatSeconds = (secondsRaw: number, options?: { withSeconds?: boolean }) => {
  const seconds = Math.max(0, Math.floor(secondsRaw));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  if (options?.withSeconds) {
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

export const formatStatValue = (name: string, value: number) => {
  if (!Number.isFinite(value)) {
    return "-";
  }

  if (name.includes("accuracy")) {
    if (value > 1) return "-";
    return `${(value * 100).toFixed(2)}%`;
  }

  if (Math.abs(value) >= 1000) {
    return numberFmt.format(Math.round(value));
  }
  return numberFmt.format(value);
};

export const isRevertedStat = (name: LogStatsName) => {
  return [
    LogStatsName.Deaths,
    LogStatsName.DamageTaken,
    LogStatsName.EnvironmentalDeaths
  ].includes(name);
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

export const getOverall = (hero: HeroWithUserStats, name: LogStatsName) => {
  return hero.stats.find((s) => s.name === name)?.overall ?? 0;
};
