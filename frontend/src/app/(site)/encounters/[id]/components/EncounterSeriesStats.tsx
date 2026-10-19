"use client";

import { useQueries } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import { PageStateCard } from "@/components/ui/page-state-card";
import StatsTableView from "@/components/match/StatsTable";
import { DisciplineWidget } from "@/disciplines/DisciplineWidget";
import { loadMatchUI } from "@/disciplines/registry/match";
import { useDisciplineMetadata } from "@/hooks/useDisciplineMetadata";
import encounterService from "@/services/encounter.service";
import type { MatchWithStats } from "@/types/encounter.types";
import type { StatDefinition } from "@/types/discipline.types";
import { buildSeriesTable } from "@/lib/stats/table";
import styles from "@/components/match/EncounterDetail.module.css";
import { encounterQueryKeys } from "@/lib/encounters/query-keys";

interface EncounterSeriesStatsProps {
  matchIds: number[];
  /** `overview`: compare observed sides; `players`: totals grouped by participation. */
  view: "overview" | "players";
}

export default function EncounterSeriesStats({
  matchIds,
  view
}: Readonly<EncounterSeriesStatsProps>) {
  const t = useTranslations();

  const queries = useQueries({
    queries: matchIds.map((id) => ({
      queryKey: encounterQueryKeys.matchDetail(id),
      queryFn: () => encounterService.getMatch(id),
      staleTime: 5 * 60_000
    }))
  });

  const loaded = queries
    .map((query) => query.data)
    .filter((data): data is MatchWithStats => data != null);
  const isLoading = queries.some((query) => query.isPending);
  const failedAll = queries.length > 0 && queries.every((query) => query.isError);

  // One encounter is one game: its first loaded observation names the owner and discipline every other one has.
  const owner = loaded[0];
  const metadata = useDisciplineMetadata(owner?.workspace_id ?? "all", owner?.discipline ?? null);

  if (failedAll || metadata.isError) {
    return (
      <PageStateCard
        state="error"
        onAction={() => {
          queries.forEach((query) => void query.refetch());
          if (metadata.isError) void metadata.refetch();
        }}
      />
    );
  }

  if (!owner) {
    return isLoading ? <SeriesStatsSkeleton /> : <PageStateCard state="empty" />;
  }
  if (!metadata.data) return <SeriesStatsSkeleton />;

  const partial = loaded.length < matchIds.length;

  return (
    <div className={styles.statsStack}>
      {partial ? (
        <output className={cn("block", styles.card, styles.cardBody, styles.statsNotice)}>
          {t("encounters.detail.statsPartial", {
            counted: loaded.length,
            total: matchIds.length
          })}
        </output>
      ) : null}

      <DisciplineWidget
        discipline={owner.discipline}
        load={loadMatchUI}
        slot="seriesStats"
        capabilities={metadata.data.discipline.capabilities}
        applicable={loaded.every((match) => match.participants.length === 2)}
        props={{ matches: loaded, metadata: metadata.data, view }}
        fallback={<GenericSeriesStatistics matches={loaded} defs={metadata.data.stat_defs} />}
      />
    </div>
  );
}

/**
 * The game-neutral series totals: each stat folded across the maps by its declared aggregation, grouped by
 * participation, for any number of participants.
 */
function GenericSeriesStatistics({
  matches,
  defs
}: Readonly<{ matches: MatchWithStats[]; defs: readonly StatDefinition[] }>) {
  const t = useTranslations();
  const table = buildSeriesTable(matches, defs);

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <h3 className={styles.cardTitle}>{t("encounters.detail.seriesTableTitle")}</h3>
        <span className={styles.cardSub}>{t("encounters.detail.seriesTableSub")}</span>
      </div>
      <StatsTableView table={table} withMaps />
    </div>
  );
}

function SeriesStatsSkeleton() {
  return (
    <div className={styles.statsStack} aria-busy>
      <span className={cn(styles.skeleton, "h-[68px] w-full")} />
      <div className={styles.statsGrid}>
        <span className={cn(styles.skeleton, "h-[320px] w-full")} />
        <span className={cn(styles.skeleton, "h-[320px] w-full")} />
      </div>
      <span className={cn(styles.skeleton, "h-[120px] w-full")} />
      <span className={cn(styles.skeleton, "h-[420px] w-full")} />
    </div>
  );
}

export type { EncounterSeriesStatsProps };
