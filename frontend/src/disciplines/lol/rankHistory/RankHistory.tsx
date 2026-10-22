"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";
import { useTranslations } from "next-intl";

import { ChartEmptyState, RankHistorySkeleton } from "@/components/RankHistoryState";
import { Card } from "@/components/ui/card";
import { useUserRankHistory } from "@/hooks/useRankHistory";
import { userQueryKeys } from "@/lib/users/query-keys";
import rankService from "@/services/rank.service";
import type { CurrentRank } from "@/types/rank.types";

import type { SlotProps } from "../../types";
import LolRankChart from "./LolRankChart";
import { LOL_QUEUES, formatLolRank, type LolQueue } from "./lol-rank";

const DISCIPLINE = "lol";
const SEASON_DAYS = 365;

/** The best current row of one queue across the player's Riot accounts. */
function bestOf(ranks: CurrentRank[], queue: LolQueue): CurrentRank | undefined {
  return ranks
    .filter((rank) => rank.queue === queue && rank.is_ranked)
    .sort((a, b) => (b.rank_value ?? -1) - (a.rank_value ?? -1))[0];
}

/** League's `rankHistory` slot: Solo/Duo and Flex now (tier, division, LP, W/L), then both over time. */
export default function RankHistory({ userId }: Readonly<SlotProps["rankHistory"]>) {
  const t = useTranslations("rankHistory");
  const [dateFrom] = useState(() => new Date(Date.now() - SEASON_DAYS * 86_400_000).toISOString());
  const current = useQuery({
    queryKey: userQueryKeys.rankCurrent(userId, DISCIPLINE),
    queryFn: () => rankService.getUserCurrentRanks(userId, DISCIPLINE)
  });
  const history = useUserRankHistory(userId, { discipline: DISCIPLINE, granularity: "raw", dateFrom });

  if (current.isLoading || history.isLoading) return <RankHistorySkeleton />;
  if (current.isError || history.isError) {
    return <ChartEmptyState icon={AlertCircle} tone="error" title={t("errorTitle")} body={t("errorBody")} />;
  }
  const ranks = current.data?.ranks ?? [];
  return (
    <div className="space-y-4">
      <dl className="grid gap-3 sm:grid-cols-2">
        {LOL_QUEUES.map((queue) => {
          const rank = bestOf(ranks, queue);
          return (
            <Card key={queue} variant="flat" className="p-4">
              <dt className="text-caption text-[color:var(--aqt-fg-dim)]">{t(`lol.${queue}`)}</dt>
              <dd className="mt-1 text-sm tabular-nums">
                {rank ? (
                  <>
                    <span className="font-medium">{formatLolRank(rank)}</span>
                    {" · "}
                    {t("lol.lp", { lp: rank.lp ?? 0 })}
                    {" · "}
                    {t("lol.record", { wins: rank.wins ?? 0, losses: rank.losses ?? 0 })}
                  </>
                ) : (
                  t("lol.unranked")
                )}
              </dd>
            </Card>
          );
        })}
      </dl>
      {(history.data?.series ?? []).length === 0 ? (
        <p className="text-sm text-[color:var(--aqt-fg-dim)]">{t("lol.empty")}</p>
      ) : (
        <section aria-label={t("lol.chartTitle")}>
          <LolRankChart series={history.data?.series ?? []} />
        </section>
      )}
    </div>
  );
}
