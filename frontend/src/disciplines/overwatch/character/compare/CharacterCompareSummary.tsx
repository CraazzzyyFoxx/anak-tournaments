"use client";

import { useTranslations } from "next-intl";

import type { CharacterCompareProps } from "@/disciplines/types";
import { characterClass } from "@/lib/catalog/attrs";
import { cn } from "@/lib/utils";

import { COL } from "./stat-columns";
import { useCharacterLeaderboard } from "./useCharacterLeaderboard";

/** The headline stat per hero class (`attrs.class`) on the per-10 board; a class without its own reads damage. */
const SIGNATURE = {
  support: { key: "per10_healing", label: "users.heroesCompare.hero.healing" },
  tank: { key: "per10_damage_blocked", label: "users.heroesCompare.hero.blocked" }
} as const;
const DEFAULT_SIGNATURE = { key: "per10_damage", label: "users.heroesCompare.hero.damage" } as const;

/** Overwatch's headline figures of the character comparison (the `characterCompareSummary` slot). */
const CharacterCompareSummary = (props: CharacterCompareProps) => {
  const t = useTranslations();
  const { character } = props;
  const { rows } = useCharacterLeaderboard(props);

  const heroClass = characterClass(character);
  const signature = SIGNATURE[(heroClass?.toLowerCase() ?? "") as keyof typeof SIGNATURE] ?? DEFAULT_SIGNATURE;
  const sigDef = COL[signature.key];
  const topSig = rows.length ? rows.reduce((best, r) => (sigDef.getValue(r) > sigDef.getValue(best) ? r : best)) : undefined;
  const bestKd = rows.length ? rows.reduce((best, r) => (r.kd > best.kd ? r : best)) : undefined;

  const stats = [
    {
      label: t("users.heroesCompare.hero.playersRanked"),
      value: rows.length || "—",
      sub: character
        ? t("users.heroesCompare.hero.withLoggedTime", { name: character.name })
        : t("users.heroesCompare.hero.pickToRank")
    },
    {
      label: t("users.heroesCompare.hero.topStat", { stat: t(signature.label) }),
      value: topSig ? topSig.username : "—",
      sub: topSig ? `${sigDef.formatValue(sigDef.getValue(topSig))} / 10` : "",
      small: true
    },
    {
      label: t("users.heroesCompare.hero.bestKd"),
      value: bestKd ? COL.kd.formatValue(bestKd.kd) : "—",
      sub: bestKd ? bestKd.username : ""
    },
    {
      label: t("users.heroesCompare.hero.role"),
      value: heroClass ?? "—",
      sub: character ? t("users.heroesCompare.hero.statColumns", { name: character.name }) : "",
      small: true,
      accent: true
    }
  ];

  return (
    <div className="grid grid-cols-2 gap-x-7 gap-y-5 text-left sm:grid-cols-4 lg:text-right">
      {stats.map((stat) => (
        <div key={stat.label} className="flex flex-col gap-1 lg:items-end">
          <span className="text-label font-bold uppercase tracking-label text-[color:var(--aqt-fg-faint)]">
            {stat.label}
          </span>
          <span
            className={cn(
              "font-onest font-bold leading-none tabular-nums",
              stat.small ? "text-2xl" : "text-3xl",
              stat.accent ? "text-[color:var(--aqt-teal)]" : "text-[color:var(--aqt-fg)]"
            )}
          >
            {stat.value}
          </span>
          {stat.sub ? <span className="text-label text-[color:var(--aqt-fg-dim)]">{stat.sub}</span> : null}
        </div>
      ))}
    </div>
  );
};

export default CharacterCompareSummary;
