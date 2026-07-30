import type { useTranslations } from "next-intl";

import { LogStatsName } from "@/types/stats.types";
import { UserRoleType } from "@/types/user.types";

/**
 * The one named translator contract for this tree. Consumers import `Translate`
 * rather than restating `ReturnType<...>` at each site.
 *
 * It has to be derived: neither `next-intl` nor `use-intl` exports a translator
 * type — next-intl's own `useTranslations.d.ts` is itself
 * `ReturnType<typeof useTranslationsType>` — so there is no upstream name to
 * import. Declaring it once here is the closest thing to owning it.
 */
export type Translate = ReturnType<typeof useTranslations<never>>;

// Maps a role type to its shared `common.roles.*` message key (dps = "Damage").
export const ROLE_LABEL_KEY: Record<
  UserRoleType,
  "common.roles.tank" | "common.roles.dps" | "common.roles.support"
> = {
  Tank: "common.roles.tank",
  Damage: "common.roles.dps",
  Support: "common.roles.support"
};

export type HeroMetricLabelKey =
  | "users.list.heroMetrics.elims"
  | "users.list.heroMetrics.fb"
  | "users.list.heroMetrics.dmg"
  | "users.list.heroMetrics.heal";

// Maps a raw log-stat name to its compact metric message key (or undefined for
// names without a localized label, in which case the raw name is shown).
export const HERO_METRIC_LABEL_KEYS: Record<string, HeroMetricLabelKey> = {
  [LogStatsName.Eliminations]: "users.list.heroMetrics.elims",
  [LogStatsName.FinalBlows]: "users.list.heroMetrics.fb",
  [LogStatsName.HeroDamageDealt]: "users.list.heroMetrics.dmg",
  [LogStatsName.HealingDealt]: "users.list.heroMetrics.heal"
};

export const parsePositiveInt = (value: string | null, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

export const parseOptionalInt = (value: string | null): number | undefined => {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.floor(parsed);
};

export const formatOptional = (value: number | null): string => {
  if (value === null) return "-";
  return value.toFixed(2);
};

export const formatPlaytime = (seconds: number, t: Translate): string => {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return t("users.list.hero.playtimeFormat", {
    h: String(hours),
    m: String(minutes),
    s: String(secs)
  });
};
