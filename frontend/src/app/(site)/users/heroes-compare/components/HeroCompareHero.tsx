"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";

import type { CharacterLeaderboardEntry } from "@/types/statistics.types";
import { characterClass } from "@/lib/catalog/attrs";
import type { CatalogEntityRead } from "@/types/catalog.types";
import { PageHero, HeroCoord } from "@/components/site/PageHero";
import { cn } from "@/lib/utils";

import { COL } from "../config/stat-columns";

interface SummaryStat {
  label: string;
  value: React.ReactNode;
  sub: string;
  /** Render the value at the smaller size used for player-name values. */
  small?: boolean;
  /** Render the value in the teal accent (used for Role). */
  accent?: boolean;
}

interface HeroCompareHeroProps {
  selectedHero: CatalogEntityRead | undefined;
  rows: CharacterLeaderboardEntry[];
}

/**
 * The leaderboard's headline stat per character class (`attrs.class`) — the columns this page reads are the
 * fixed per-10 leaderboard wire; a class without its own headline reads damage.
 */
const SIGNATURE = {
  support: { key: "per10_healing", label: "users.heroesCompare.hero.healing" },
  tank: { key: "per10_damage_blocked", label: "users.heroesCompare.hero.blocked" }
} as const;
const DEFAULT_SIGNATURE = { key: "per10_damage", label: "users.heroesCompare.hero.damage" } as const;

const HeroCompareHero = ({ selectedHero, rows }: HeroCompareHeroProps) => {
  const t = useTranslations();

  const stats = useMemo<SummaryStat[]>(() => {
    const classCode = characterClass(selectedHero)?.toLowerCase() ?? "";
    const signature = SIGNATURE[classCode as keyof typeof SIGNATURE] ?? DEFAULT_SIGNATURE;
    const sigShort = t(signature.label);
    const sigDef = COL[signature.key];
    const kdDef = COL.kd;
    const roleLabel = characterClass(selectedHero) ?? "—";

    const topSig = rows.length
      ? rows.reduce((best, r) => (sigDef.getValue(r) > sigDef.getValue(best) ? r : best))
      : undefined;
    const bestKd = rows.length ? rows.reduce((best, r) => (r.kd > best.kd ? r : best)) : undefined;

    return [
      {
        label: t("users.heroesCompare.hero.playersRanked"),
        value: rows.length || "—",
        sub: selectedHero
          ? t("users.heroesCompare.hero.withLoggedTime", { name: selectedHero.name })
          : t("users.heroesCompare.hero.pickToRank"),
      },
      {
        label: t("users.heroesCompare.hero.topStat", { stat: sigShort }),
        value: topSig ? topSig.username : "—",
        sub: topSig ? `${sigDef.formatValue(sigDef.getValue(topSig))} / 10` : "",
        small: true,
      },
      {
        label: t("users.heroesCompare.hero.bestKd"),
        value: bestKd ? kdDef.formatValue(bestKd.kd) : "—",
        sub: bestKd ? bestKd.username : "",
      },
      {
        label: t("users.heroesCompare.hero.role"),
        value: roleLabel,
        sub: selectedHero ? t("users.heroesCompare.hero.statColumns", { name: selectedHero.name }) : "",
        small: true,
        accent: true,
      },
    ];
  }, [selectedHero, rows, t]);

  return (
    <PageHero
      eyebrow={
        <HeroCoord className="inline-flex items-center gap-2">
          <Link href="/users" className="transition-colors hover:text-[color:var(--aqt-teal)]">
            {t("users.heroesCompare.hero.usersBreadcrumb")}
          </Link>
          <ChevronRight aria-hidden className="h-3 w-3 opacity-50" />
          <span>{t("users.heroesCompare.hero.breadcrumb")}</span>
        </HeroCoord>
      }
      title={t("users.heroesCompare.hero.title")}
      lede={t("users.heroesCompare.hero.lede")}
      aside={
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
              {stat.sub ? (
                <span className="text-label text-[color:var(--aqt-fg-dim)]">{stat.sub}</span>
              ) : null}
            </div>
          ))}
        </div>
      }
    />
  );
};

export default HeroCompareHero;
