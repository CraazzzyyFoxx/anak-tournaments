"use client";

import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import tournamentService from "@/services/tournament.service";
import encounterService from "@/services/encounter.service";
import statisticsService from "@/services/statistics.service";
import { useWorkspaceStore } from "@/stores/workspace.store";
import { tournamentQueryKeys } from "@/lib/tournament-query-keys";
import { TOURNAMENT_STATUS_ORDER, countByTournamentStatus } from "@/lib/tournament-status";
import type { TournamentStatus } from "@/types/tournament.types";
import { Skeleton } from "@/components/ui/skeleton";
import { PageStateCard } from "@/components/ui/page-state-card";
import { useQueryParams } from "@/hooks/useQueryParams";

import TournamentsHero from "./components/TournamentsHero";
import FeaturedLive from "./components/FeaturedLive";
import TournamentsFilters, {
  type SortBy,
  type StatusFilter,
  type TypeFilter
} from "./components/TournamentsFilters";
import TournamentsTable from "./components/TournamentsTable";
import { groupLiveByTournament } from "./components/tournaments-helpers";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 11;

const SORT_BY: readonly SortBy[] = ["latest", "oldest", "participants"];
const TYPE_FILTERS: readonly TypeFilter[] = ["all", "standard", "league"];

const TournamentsPageSkeleton = () => (
  <div className="space-y-6">
    <Skeleton className="h-[200px] w-full rounded-2xl" />
    <Skeleton className="h-12 w-full rounded-xl" />
    <Skeleton className="h-[520px] w-full rounded-xl" />
  </div>
);

const TournamentsPage = () => {
  const t = useTranslations();
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const workspaceName = workspaces.find((w) => w.id === workspaceId)?.name;

  // Filters live in the URL, so a filtered view survives a reload and can be
  // shared. `resetOnChange: ["page"]` drops the page whenever a filter moves.
  const { searchParams, setParams } = useQueryParams({ resetOnChange: ["page"] });

  const statusParam = searchParams?.get("status");
  const statusFilter: StatusFilter =
    statusParam && (TOURNAMENT_STATUS_ORDER as string[]).includes(statusParam)
      ? (statusParam as TournamentStatus)
      : "all";

  const typeParam = searchParams?.get("type");
  const typeFilter: TypeFilter = TYPE_FILTERS.includes(typeParam as TypeFilter)
    ? (typeParam as TypeFilter)
    : "all";

  const search = searchParams?.get("q") ?? "";

  const sortParam = searchParams?.get("sort");
  const sortBy: SortBy = SORT_BY.includes(sortParam as SortBy) ? (sortParam as SortBy) : "latest";

  const pageParam = Number(searchParams?.get("page"));
  const page = Number.isFinite(pageParam) && pageParam >= 1 ? Math.floor(pageParam) : 1;

  const hasActiveFilters = statusFilter !== "all" || typeFilter !== "all" || search.trim() !== "";
  const clearFilters = () => setParams({ status: null, type: null, q: null, page: null });

  const {
    data: tournaments,
    isLoading,
    isError,
    refetch
  } = useQuery({
    queryKey: ["tournaments", workspaceId],
    queryFn: () => tournamentService.getAll(null, workspaceId)
  });

  const { data: overview } = useQuery({
    queryKey: tournamentQueryKeys.encountersOverview(workspaceId),
    queryFn: () => encounterService.getOverview("", {}, workspaceId),
    refetchInterval: 30_000,
    staleTime: 15_000
  });

  const { data: overall } = useQuery({
    queryKey: tournamentQueryKeys.overallStatistics(workspaceId),
    queryFn: () =>
      statisticsService.getOverallStatistics(workspaceId != null ? { workspaceId } : undefined)
  });

  const allResults = useMemo(() => tournaments?.results ?? [], [tournaments]);

  const statusCounts = useMemo(
    () => countByTournamentStatus(allResults.map((tournament) => tournament.status)),
    [allResults]
  );
  const leagueCount = useMemo(() => allResults.filter((t) => t.is_league).length, [allResults]);

  const filteredTournaments = useMemo(() => {
    let filtered = allResults;

    if (statusFilter !== "all") {
      filtered = filtered.filter((t) => t.status === statusFilter);
    }
    if (typeFilter === "standard") {
      filtered = filtered.filter((t) => !t.is_league);
    } else if (typeFilter === "league") {
      filtered = filtered.filter((t) => t.is_league);
    }

    const query = search.trim().toLowerCase();
    if (query) {
      filtered = filtered.filter((t) => t.name.toLowerCase().includes(query));
    }

    return [...filtered].sort((a, b) => {
      switch (sortBy) {
        case "latest":
          return new Date(b.start_date).getTime() - new Date(a.start_date).getTime();
        case "oldest":
          return new Date(a.start_date).getTime() - new Date(b.start_date).getTime();
        case "participants":
          return (b.participants_count || 0) - (a.participants_count || 0);
        default:
          return 0;
      }
    });
  }, [allResults, statusFilter, typeFilter, search, sortBy]);

  const liveGroups = useMemo(
    () => groupLiveByTournament(overview?.featured.live ?? []),
    [overview]
  );


  if (isLoading) {
    return (
      <div className="aqt-tn">
        <TournamentsPageSkeleton />
      </div>
    );
  }

  // Platform totals come from the same service that feeds `/` and `/statistics`,
  // so the three public pages cannot state different facts about the platform.
  // The list payload only ever backs the scoped "N shown" label below.
  const shownCount = filteredTournaments.length;

  return (
    <div className="aqt-tn space-y-6">
      <TournamentsHero
        workspaceName={workspaceName}
        liveEvents={(statusCounts.live ?? 0) + (statusCounts.playoffs ?? 0)}
        liveMatches={overview?.kpis.live_now_count ?? 0}
        totalPlayers={overall?.players ?? 0}
        totalTeams={overall?.teams ?? 0}
      />

      <section className="toolbar">
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <h2
            style={{
              margin: 0,
              fontFamily: "var(--display)",
              fontWeight: 700,
              fontSize: 22,
              textTransform: "uppercase",
              letterSpacing: ".04em"
            }}
          >
            {t("tournamentsList.heading.all")}
          </h2>
          <span
            className="tn-id"
            style={{
              marginLeft: 6,
              background: "var(--aqt-overlay-1)",
              border: "1px solid var(--aqt-border)",
              padding: "3px 8px",
              borderRadius: 6
            }}
          >
            {t("tournamentsList.heading.shown", { count: shownCount })}
          </span>
        </div>
      </section>

      <FeaturedLive groups={liveGroups} />

      <TournamentsFilters
        total={allResults.length}
        statusCounts={statusCounts}
        statusFilter={statusFilter}
        onStatusChange={(value) => setParams({ status: value === "all" ? null : value })}
        typeFilter={typeFilter}
        leagueCount={leagueCount}
        standardCount={allResults.length - leagueCount}
        onTypeChange={(value) => setParams({ type: value === "all" ? null : value })}
        search={search}
        onSearchChange={(value) => setParams({ q: value })}
        sortBy={sortBy}
        onSortChange={(value) => setParams({ sort: value === "latest" ? null : value })}
      />

      {isError ? (
        <PageStateCard state="error" onAction={() => void refetch()} />
      ) : shownCount === 0 ? (
        hasActiveFilters ? (
          <PageStateCard
            state="filtered-empty"
            title={t("tournamentsList.empty.title")}
            description={t("tournamentsList.empty.body")}
            onAction={clearFilters}
          />
        ) : (
          <PageStateCard state="empty" />
        )
      ) : (
        <TournamentsTable
          tournaments={filteredTournaments}
          page={page}
          pageSize={PAGE_SIZE}
          onPageChange={(next) => setParams({ page: next === 1 ? null : next })}
        />
      )}
    </div>
  );
};

export default TournamentsPage;
