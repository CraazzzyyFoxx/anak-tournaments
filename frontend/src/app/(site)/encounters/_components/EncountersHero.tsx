"use client";

import { useTranslations } from "next-intl";
import { useFormatter } from "@/lib/datetime/client";

import { HoverPrefetchLink } from "@/components/HoverPrefetchLink";
import { PageHero, HeroCoord, HeroStat } from "@/components/site/PageHero";
import type { EncounterOverview } from "@/types/encounter.types";

import { formatPercent } from "./encounters.helpers";

/**
 * Compact header plus four global numbers: the overview read with no filters (the game and workspace only), so the
 * toolbar narrowing the list never rewrites them.
 */
export function EncountersHero({ overview }: Readonly<{ overview: EncounterOverview | undefined }>) {
  const t = useTranslations();
  const format = useFormatter();
  const dash = "-";
  const counts = overview?.counts;

  return (
    <PageHero
      compact
      eyebrow={
        <HeroCoord>
          <HoverPrefetchLink href="/tournaments" className="transition-colors hover:text-[color:var(--aqt-teal)]">
            {t("encounters.hero.eyebrowRoot")}
          </HoverPrefetchLink>{" "}
          · {t("encounters.hero.eyebrowCurrent")}
        </HeroCoord>
      }
      title={t("encounters.hero.title")}
      lede={t("encounters.hero.lede")}
      aside={
        <div className="flex flex-wrap gap-x-7 gap-y-4 lg:justify-end">
          <HeroStat
            label={t("encounters.hero.completed")}
            value={counts ? format.number(counts.completed) : dash}
            sub={
              overview && overview.recent_completed > 0
                ? t("encounters.hero.recent", { count: format.number(overview.recent_completed) })
                : undefined
            }
          />
          <HeroStat
            label={t("encounters.hero.withLogs")}
            value={
              overview && overview.counts.completed > 0
                ? formatPercent(format, overview.completed_with_logs / overview.counts.completed)
                : dash
            }
            sub={
              overview
                ? t("encounters.hero.withLogsOf", {
                    count: format.number(overview.completed_with_logs),
                    total: format.number(overview.counts.completed)
                  })
                : undefined
            }
          />
          <HeroStat label={t("encounters.hero.live")} value={counts ? format.number(counts.live) : dash} />
          <HeroStat label={t("encounters.hero.upcoming")} value={counts ? format.number(counts.upcoming) : dash} />
        </div>
      }
    />
  );
}
