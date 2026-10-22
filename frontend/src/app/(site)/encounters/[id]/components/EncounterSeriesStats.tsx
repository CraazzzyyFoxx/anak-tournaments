"use client";

import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import { PageStateCard } from "@/components/ui/page-state-card";
import { Skeleton } from "@/components/ui/skeleton";
import LabelledSelect from "@/components/match/LabelledSelect";
import StatsTableView from "@/components/match/StatsTable";
import { DisciplineWidget } from "@/disciplines/DisciplineWidget";
import { loadMatchUI } from "@/disciplines/registry/match";
import { useDisciplineMetadata } from "@/hooks/useDisciplineMetadata";
import encounterService from "@/services/encounter.service";
import type { MatchWithStats } from "@/types/encounter.types";
import type { DisciplineMetadata } from "@/types/discipline.types";
import { buildSeriesTable, memberEntities } from "@/lib/stats/table";
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
        fallback={<GenericSeriesStatistics matches={loaded} metadata={metadata.data} />}
      />
    </div>
  );
}

/**
 * The game-neutral series totals: each stat folded across the maps by its declared aggregation, grouped by
 * participation, for any number of participants, at the member totals or one character's rows (never both
 * added).
 */
function GenericSeriesStatistics({
  matches,
  metadata
}: Readonly<{ matches: MatchWithStats[]; metadata: DisciplineMetadata }>) {
  const t = useTranslations();
  const [entity, setEntity] = useState("none");
  const entities = useMemo(() => memberEntities(matches, 0), [matches]);
  const active = entities.some((candidate) => String(candidate.id) === entity)
    ? Number(entity)
    : "none";
  const table = buildSeriesTable(matches, metadata.stat_defs, active);

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <h3 className={styles.cardTitle}>{t("encounters.detail.seriesTableTitle")}</h3>
        <span className={styles.cardSub}>{t("encounters.detail.seriesTableSub")}</span>
      </div>
      {entities.length > 0 ? (
        <div className="px-4 pb-3">
          <LabelledSelect
            label={t("matches.native.grainLabel")}
            value={String(active)}
            onValueChange={setEntity}
            options={[
              { value: "none", label: t("matches.native.grainTotals") },
              ...entities.map((candidate) => ({
                value: String(candidate.id),
                label: candidate.name
              }))
            ]}
          />
        </div>
      ) : null}
      <StatsTableView
        table={table}
        definitions={metadata.stat_defs}
        withMaps
        empty={active === "none" ? "members" : "values"}
      />
    </div>
  );
}

function SeriesStatsSkeleton() {
  return (
    <div className={styles.statsStack} aria-busy>
      <Skeleton className="h-[68px] w-full" />
      <div className={styles.statsGrid}>
        <Skeleton className="h-[320px] w-full" />
        <Skeleton className="h-[320px] w-full" />
      </div>
      <Skeleton className="h-[120px] w-full" />
      <Skeleton className="h-[420px] w-full" />
    </div>
  );
}

export type { EncounterSeriesStatsProps };
