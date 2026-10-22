"use client";

import { useTranslations } from "next-intl";
import { useFormatter } from "@/lib/datetime/client";
import { TrendingUp } from "lucide-react";

import { PageHero, HeroCoord, HeroStat } from "@/components/site/PageHero";
import type { EncounterOverview } from "@/types/encounter.types";

import { formatPercent } from "./encounters.helpers";
import { countLabel } from "./encounters.model";
import styles from "./Encounters.module.css";

const PERCENT = <em className="not-italic text-[color:var(--aqt-teal)]">%</em>;

export function EncountersHero({ overview }: Readonly<{ overview: EncounterOverview }>) {
  const t = useTranslations();
  const format = useFormatter();
  return (
    <PageHero
      eyebrow={<HeroCoord>{t("encounters.hero.eyebrow")}</HeroCoord>}
      title={t("encounters.hero.title")}
      lede={t("encounters.hero.lede")}
      aside={
        <div className={styles.heroStats}>
          <HeroStat
            label={t("encounters.hero.totalLabel")}
            value={countLabel(format, overview.kpis.total_encounters)}
            sub={
              overview.kpis.recent_count ? (
                <>
                  <span className={styles.delta}>
                    <TrendingUp aria-hidden className="inline size-4 align-[-3px]" />
                    {/* Icon is decorative; the sign reaches AT through this. */}
                    <span className="sr-only">+</span>{" "}
                    {countLabel(format, overview.kpis.recent_count)}
                  </span>{" "}
                  {t("encounters.hero.last7Days")}
                </>
              ) : (
                t("encounters.hero.allTime")
              )
            }
          />
          <HeroStat
            label={t("encounters.hero.withLogsLabel")}
            value={
              <>
                {overview.kpis.with_logs_pct}
                {PERCENT}
              </>
            }
            sub={t("encounters.hero.ofSeries", {
              count: countLabel(format, overview.kpis.with_logs_count),
              total: countLabel(format, overview.kpis.total_encounters)
            })}
          />
          <HeroStat
            label={t("encounters.hero.avgClosenessLabel")}
            value={
              overview.kpis.avg_closeness != null ? (
                <>
                  {formatPercent(overview.kpis.avg_closeness, "—").replace("%", "")}
                  {PERCENT}
                </>
              ) : (
                "—"
              )
            }
            sub={t("encounters.hero.acrossReported")}
          />
          <HeroStat
            label={t("encounters.hero.liveNowLabel")}
            value={countLabel(format, overview.kpis.live_now_count)}
            sub={t("encounters.hero.upcomingCount", {
              count: countLabel(format, overview.kpis.upcoming_count)
            })}
          />
        </div>
      }
    />
  );
}
