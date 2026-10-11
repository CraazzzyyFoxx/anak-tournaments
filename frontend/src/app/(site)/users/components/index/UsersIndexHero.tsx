"use client";

import { useTranslations } from "next-intl";
import { useFormatter } from "@/lib/datetime/client";

import { HoverPrefetchLink } from "@/components/HoverPrefetchLink";
import { PageHero, HeroCoord, HeroStat } from "@/components/site/PageHero";
import type { UserOverviewStats } from "@/types/user.types";

/** Compact roster header plus the four counters the stats read supplies. */
export function UsersIndexHero({ stats }: Readonly<{ stats: UserOverviewStats | undefined }>) {
  const t = useTranslations();
  const format = useFormatter();
  const dash = "-";

  return (
    <PageHero
      compact
      eyebrow={
        <HeroCoord>
          <HoverPrefetchLink
            href="/"
            className="transition-colors hover:text-[color:var(--aqt-teal)]"
          >
            {t("users.list.hero.eyebrowRoster")}
          </HoverPrefetchLink>{" "}
          · {t("users.list.hero.eyebrowCurrent")}
        </HeroCoord>
      }
      title={t("users.list.hero.title")}
      lede={t("users.list.hero.lede")}
      aside={
        <div className="flex flex-wrap gap-x-7 gap-y-4 lg:justify-end">
          <HeroStat
            label={t("users.list.stats.totalPlayers")}
            value={stats ? format.number(stats.total_players) : dash}
          />
          <HeroStat
            label={t("users.list.stats.activeLast30d")}
            value={stats ? format.number(stats.active_last_30d) : dash}
            sub={
              stats
                ? t("users.list.stats.ofRoster", { pct: String(Math.round(stats.active_last_30d_pct)) })
                : undefined
            }
          />
          <HeroStat
            label={t("users.list.stats.withLogs")}
            value={stats ? format.number(stats.with_logs_count) : dash}
            sub={
              stats
                ? t("users.list.stats.ofRoster", { pct: String(Math.round(stats.with_logs_pct)) })
                : undefined
            }
          />
          <HeroStat
            label={t("users.list.stats.avgTournamentsPerPlayer")}
            value={stats ? stats.avg_tournaments_per_player.toFixed(1) : dash}
            sub={
              stats
                ? t("users.list.stats.median", {
                    value: stats.median_tournaments_per_player.toFixed(0)
                  })
                : undefined
            }
          />
        </div>
      }
    />
  );
}
