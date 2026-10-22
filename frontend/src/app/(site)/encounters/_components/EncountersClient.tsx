"use client";

import { useTranslations } from "next-intl";
import { useFormatter } from "@/lib/datetime/client";

import { DataPagination } from "@/components/ui/data-pagination";
import { PageStateCard } from "@/components/ui/page-state-card";
import { EncountersDataTable, FULL_ENCOUNTER_COLUMNS } from "@/components/EncountersTable";
import { GameScopeControl } from "@/components/workspace/GameScopeControl";
import { useGameBoundParams } from "@/components/workspace/scope-pill-store";
import { useGameDescriptors } from "@/hooks/useGameDescriptors";
import { useGameScope } from "@/hooks/useGameScope";
import { ALL_DISCIPLINES, showsGameMarks, type GameScopeInit } from "@/lib/site/discipline-scope";
import type { StatsScope } from "@/lib/site/stats-scope";

import Loading from "../loading";
import {
  EMPTY_OVERVIEW,
  ENCOUNTERS_PAGE_SIZE,
  GAME_SCOPED_FILTERS,
  type EncounterFilterState
} from "./encounters.helpers";
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
  initial: GameScopeInit;
  initialFilters: EncounterFilterState;
  initialPage: number;
  initialError?: string | null;
  scope: StatsScope;
};

/** The URL params of one game's tournament/stage: a game picked in the scope pill drops them (ruling R5). */
const GAME_SCOPED_PARAMS = Object.keys(GAME_SCOPED_FILTERS);

/**
 * The encounters index (spec §5, multi): every game under "all games", one game under a game. Filter/URL state and
 * the reads it drives live in `useEncountersFilters` / `useEncountersData`; everything below is layout plus the one
 * piece of state neither owns — which page of the list is on screen.
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
  const gameScope = useGameScope({ initial });
  useGameBoundParams(GAME_SCOPED_PARAMS);
  const { resolution } = gameScope;
  const discipline = gameScope.game;
  const ready = resolution?.game.kind === "all" || resolution?.game.kind === "game";
  const unavailable = resolution?.game.kind === "invalid" || resolution?.game.kind === "empty";
  // "all" or the game once readable, `null` otherwise: another game drops the game-bound filters and returns to the
  // first page; leaving an unavailable state reads them from the URL again.
  const gameKey = ready ? (discipline ?? ALL_DISCIPLINES) : null;
  const controls = useEncountersFilters(initialFilters, initialPage, gameKey, unavailable);
  const { effectiveFilters, page } = controls;
  const { listQuery, overviewQuery, tournamentsLookupQuery } = useEncountersData({
    seed,
    initialFilters,
    initialPage,
    effectiveFilters,
    page,
    scope,
    discipline,
    enabled: ready
  });
  const descriptors = useGameDescriptors();
  const marks = resolution !== null && showsGameMarks(resolution, gameScope.games ?? []) ? descriptors : undefined;

  const overview = overviewQuery.data ?? EMPTY_OVERVIEW;
  const rows = listQuery.data?.results ?? [];
  const total = listQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / ENCOUNTERS_PAGE_SIZE));
  const isFiltered = hasActiveFilters(effectiveFilters);
  const showingStart = rows.length ? (page - 1) * ENCOUNTERS_PAGE_SIZE + 1 : 0;
  const showingEnd = Math.min(page * ENCOUNTERS_PAGE_SIZE, total);

  if (unavailable) {
    return <GameScopeControl scope={gameScope} variant="multi" dropParams={GAME_SCOPED_PARAMS} headingLevel={1} />;
  }
  if (!ready) {
    return gameScope.isError ? (
      <PageStateCard state="error" headingLevel={1} description={t("common.loadError")} onAction={gameScope.refetch} />
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
        games={marks}
      />
    );
  };

  return (
    <div className={styles.surface}>
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
        gameBound={discipline !== null}
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
              leading={t("encounters.list.showing", {
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
