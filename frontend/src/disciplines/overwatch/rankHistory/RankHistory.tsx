"use client";

import { useMemo } from "react";
import { AlertCircle } from "lucide-react";
import { useTranslations } from "next-intl";

import { ChartEmptyState, RankHistorySkeleton } from "@/components/RankHistoryState";
import {
  BACKEND_GRANULARITY,
  getDefaultDateFrom,
  useRankHistoryGranularity,
  useUserRankHistory
} from "@/hooks/useRankHistory";

import type { SlotProps } from "../../types";
import RankHistoryChart from "./RankHistoryChart";

/**
 * OverFast rank history for one player, across all their battle.net accounts — the Overwatch `rankHistory`
 * slot. The host resolves the player and the capability gate; this reads and draws the series.
 */
export default function RankHistory({ userId }: Readonly<SlotProps["rankHistory"]>) {
  const t = useTranslations();
  const [granularity, setGranularity] = useRankHistoryGranularity();
  const dateFrom = useMemo(() => getDefaultDateFrom(granularity), [granularity]);
  const history = useUserRankHistory(userId, {
    discipline: "overwatch",
    granularity: BACKEND_GRANULARITY[granularity],
    dateFrom
  });

  if (history.isLoading) return <RankHistorySkeleton />;
  if (history.isError) {
    return (
      <ChartEmptyState
        icon={AlertCircle}
        tone="error"
        title={t("rankHistory.errorTitle")}
        body={t("rankHistory.errorBody")}
      />
    );
  }
  return (
    <RankHistoryChart
      series={history.data?.series ?? []}
      granularity={granularity}
      onGranularityChange={setGranularity}
    />
  );
}
