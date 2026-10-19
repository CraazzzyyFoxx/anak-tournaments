"use client";

import { useTranslations } from "next-intl";
import { useFormatter } from "@/lib/datetime/client";

import { DataPagination } from "@/components/ui/data-pagination";
import { PageStateCard } from "@/components/ui/page-state-card";
import { EncountersDataTable, FULL_ENCOUNTER_COLUMNS } from "@/components/EncountersTable";
import { DisciplineSelector, DisciplineUnavailable } from "@/components/workspace/DisciplineSelector";
import { useBrowsingDiscipline } from "@/hooks/useBrowsingDiscipline";
import type { BrowsingDisciplineInit } from "@/lib/site/discipline-scope";
import type { StatsScope } from "@/lib/site/stats-scope";

import Loading from "../loading";
import { EMPTY_OVERVIEW, ENCOUNTERS_PAGE_SIZE, type EncounterFilterState } from "./encounters.helpers";
import { countLabel, hasActiveFilters } from "./encounters.model";
import { useEncountersFilters } from "./useEncountersFilters";
import { useEncountersData, type EncountersSeed } from "./useEncountersData";
import { EncountersHero } from "./EncountersHero";
import { EncountersViewsBar } from "./EncountersViewsBar";
import { EncountersFilterBar } from "./EncountersFilterBar";
import { EncountersInsights } from "./EncountersInsights";
import { EncountersFeatured } from "./EncountersFeatured";
import { EncountersRail } from "./EncountersRail";
import styles from "./Encounters.module.css";

type EncountersClientProps = {
  seed: EncountersSeed | null;
  initial: BrowsingDisciplineInit;
  initialFilters: EncounterFilterState;
  initialPage: number;
  initialError?: string | null;
  scope: StatsScope;
};

/**
 * The encounters index of one game (§2.3 concrete browsing). Filter/URL state and
 * the reads it drives live in `useEncountersFilters` / `useEncountersData`;
 * everything below is layout plus the one piece of state neither owns — which
 * page of the list is on screen.
 */
export default function EncountersClient({
  seed,
  initial,
  initialFilters,
  initialPage,
  initialError,
  scope
}: Readonly<EncountersClientProps>) {
  const t = useTranslations();
  const format = useFormatter();
  const browsing = useBrowsingDiscipline({ allowsAll: false, initial });
  const { resolved, disciplines } = browsing;
  const discipline = resolved?.kind === "concrete" ? resolved.code : null;
  const controls = useEncountersFilters(initialFilters, initialPage, discipline);
  const { effectiveFilters, page } = controls;
  const { listQuery, overviewQuery, tournamentsLookupQuery } = useEncountersData({
    seed,
    initialFilters,
    initialPage,
    effectiveFilters,
    page,
    scope,
    discipline
  });

  const overview = overviewQuery.data ?? EMPTY_OVERVIEW;
  const rows = listQuery.data?.results ?? [];
  const total = listQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / ENCOUNTERS_PAGE_SIZE));
  const isFiltered = hasActiveFilters(effectiveFilters);
  const showingStart = rows.length ? (page - 1) * ENCOUNTERS_PAGE_SIZE + 1 : 0;
  const showingEnd = Math.min(page * ENCOUNTERS_PAGE_SIZE, total);

  if ((resolved?.kind === "invalid" || resolved?.kind === "empty") && disciplines) {
    return (
      <DisciplineUnavailable resolved={resolved} disciplines={disciplines} allowsAll={false} onSelect={browsing.select} />
    );
  }
  if (discipline === null) {
    return browsing.isError ? (
      <PageStateCard state="error" description={t("common.loadError")} onAction={browsing.refetch} />
    ) : (
      <Loading />
    );
  }

  const listBody = () => {
    if (listQuery.isError) {
      return <PageStateCard state="error" onAction={() => void listQuery.refetch()} />;
    }
    if (!rows.length && !listQuery.isFetching) {
      return (
        <PageStateCard
          state={isFiltered ? "filtered-empty" : "empty"}
          onAction={isFiltered ? controls.clearFilters : undefined}
        />
      );
    }
    return (
      <EncountersDataTable
        rows={rows}
        columns={FULL_ENCOUNTER_COLUMNS}
        loading={listQuery.isFetching && !rows.length}
      />
    );
  };

  return (
    <div className={styles.surface}>
      {disciplines ? (
        <div className="flex justify-end">
          <DisciplineSelector disciplines={disciplines} value={discipline} allowsAll={false} onSelect={browsing.select} />
        </div>
      ) : null}
      <EncountersHero overview={overview} />

      {initialError ? (
        <PageStateCard
          state="error"
          description={initialError}
          onAction={() => {
            void listQuery.refetch();
            void overviewQuery.refetch();
          }}
        />
      ) : null}

      <EncountersViewsBar
        filters={effectiveFilters}
        presetCounts={overview.preset_counts}
        onApplyFilters={controls.applyFilters}
      />

      <EncountersFilterBar
        filters={controls.filters}
        searchValue={controls.searchValue}
        kpis={overview.kpis}
        tournaments={tournamentsLookupQuery.data ?? []}
        onSearchChange={controls.setSearchValue}
        onPatch={controls.patchFilters}
      />

      <EncountersInsights overview={overview} />

      <EncountersFeatured overview={overview} />

      <section aria-label={t("encounters.list.title")}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>{t("encounters.list.title")}</h2>
          <span className={styles.sectionMeta}>
            {t("encounters.list.pageMeta", {
              page: String(page),
              total: String(totalPages),
              sort: effectiveFilters.sort
            })}
          </span>
        </div>
        <div className={styles.gridTable}>
          <div className="flex min-w-0 flex-col gap-3">
            {listBody()}
            <DataPagination
              page={page}
              totalPages={totalPages}
              onPageChange={controls.setPage}
              summary={t("encounters.list.showing", {
                start: String(showingStart),
                end: String(showingEnd),
                total: countLabel(format, total)
              })}
            />
          </div>

          <EncountersRail overview={overview} />
        </div>
      </section>
    </div>
  );
}
