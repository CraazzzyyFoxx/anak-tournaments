"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import { ChartEmptyState, RankHistorySkeleton } from "@/components/RankHistoryState";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import Image from "@/components/ui/image";
import { useDisciplineMetadata } from "@/hooks/useDisciplineMetadata";
import { useUserRankHistory } from "@/hooks/useRankHistory";
import { useFormatter } from "@/lib/datetime/client";
import { userQueryKeys } from "@/lib/users/query-keys";
import rankService from "@/services/rank.service";
import type { NativeTier } from "@/types/discipline.types";
import type { RankSeries } from "@/types/rank.types";

import type { SlotProps } from "../../types";

const DISCIPLINE = "deadlock";
const SEASON_DAYS = 365;

/** The ladder rank (`Mystic 6`, its emblem) holding a rank value; the ladder is top-first and its top is open-ended. */
function tierAt(ladder: readonly NativeTier[], value: number): NativeTier | undefined {
  return ladder.find((tier) => value >= tier.rank_min && (tier.rank_max == null || value <= tier.rank_max));
}

/**
 * One row per change, the best rank among the player's Steam accounts currently ranked (each account's last
 * observation carried forward, an unranked one dropping out), so two accounts never zig-zag one line; `null` is a
 * stretch with no ranked account.
 */
function chartRows(series: RankSeries[]): { at: number; rank: number | null }[] {
  const changes = series
    .flatMap((line) =>
      line.points.map((point) => ({
        account: line.social_account_id,
        at: Date.parse(point.captured_at),
        value: point.is_ranked ? point.rank_value : null
      }))
    )
    .sort((a, b) => a.at - b.at);
  const ranked = new Map<number, number>();
  const rows = new Map<number, { at: number; rank: number | null }>();
  for (const change of changes) {
    if (change.value == null) ranked.delete(change.account);
    else ranked.set(change.account, change.value);
    rows.set(change.at, { at: change.at, rank: ranked.size > 0 ? Math.max(...ranked.values()) : null });
  }
  return [...rows.values()];
}

/** Deadlock's `rankHistory` slot: the best current rank across the player's Steam accounts, then its history. */
export default function RankHistory({ userId, axis }: Readonly<SlotProps["rankHistory"]>) {
  const t = useTranslations("rankHistory");
  const format = useFormatter();
  const [dateFrom] = useState(() => new Date(Date.now() - SEASON_DAYS * 86_400_000).toISOString());
  const metadata = useDisciplineMetadata(axis, DISCIPLINE);
  const current = useQuery({
    queryKey: userQueryKeys.rankCurrent(userId, DISCIPLINE),
    queryFn: () => rankService.getUserCurrentRanks(userId, DISCIPLINE)
  });
  const history = useUserRankHistory(userId, { discipline: DISCIPLINE, granularity: "raw", dateFrom });

  if (metadata.isLoading || current.isLoading || history.isLoading) return <RankHistorySkeleton />;
  if (metadata.isError || current.isError || history.isError) {
    return <ChartEmptyState icon={AlertCircle} tone="error" title={t("errorTitle")} body={t("errorBody")} />;
  }
  const ladder = metadata.data?.native_ladder ?? [];
  const best = (current.data?.ranks ?? [])
    .filter((rank) => rank.is_ranked && rank.rank_value != null)
    .sort((a, b) => (b.rank_value ?? 0) - (a.rank_value ?? 0))[0];
  const tier = best?.rank_value != null ? tierAt(ladder, best.rank_value) : undefined;
  const rows = chartRows(history.data?.series ?? []);
  const config: ChartConfig = { rank: { label: t("deadlock.rank"), color: "hsl(var(--chart-1))" } };

  return (
    <div className="space-y-4">
      <dl className="flex items-center gap-3 rounded-xl border border-[color:var(--aqt-border)] bg-[color:var(--aqt-card)] p-4">
        {tier ? <Image src={tier.icon_url} alt="" width={40} height={40} aria-hidden /> : null}
        <div>
          <dt className="text-caption text-[color:var(--aqt-fg-dim)]">{t("deadlock.current")}</dt>
          <dd className="mt-1 text-sm font-medium tabular-nums">
            {tier?.name ?? best?.division ?? t("deadlock.unranked")}
          </dd>
        </div>
      </dl>
      {rows.length === 0 ? (
        <p className="text-sm text-[color:var(--aqt-fg-dim)]">{t("deadlock.empty")}</p>
      ) : (
        <section aria-label={t("deadlock.chartTitle")}>
          <ChartContainer config={config} className="h-64 w-full">
            <LineChart data={rows} margin={{ left: 4, right: 12 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="at" type="number" scale="time" domain={["dataMin", "dataMax"]}
                tickFormatter={(value: number) => format.dateTime(new Date(value), { month: "short", day: "numeric" })} />
              <YAxis width={96} domain={["dataMin", "dataMax"]}
                tickFormatter={(value: number) => tierAt(ladder, value)?.name ?? ""} />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(_, payload) =>
                      payload[0] ? format.dateTime(new Date(payload[0].payload.at), { dateStyle: "medium" }) : null
                    }
                    formatter={(value) => tierAt(ladder, Number(value))?.name}
                  />
                }
              />
              <Line dataKey="rank" type="stepAfter" stroke="var(--color-rank)" />
            </LineChart>
          </ChartContainer>
        </section>
      )}
    </div>
  );
}
