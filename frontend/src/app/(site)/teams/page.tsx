"use client";

import { Suspense, useEffect, useMemo } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";

import teamService from "@/services/team.service";
import tournamentService from "@/services/tournament.service";
import { TournamentTeamCard, TournamentTeamCardSkeleton } from "@/components/TournamentTeamCard";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PageStateCard } from "@/components/ui/page-state-card";
import { SearchField } from "@/components/ui/search-field";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueryParams } from "@/hooks/useQueryParams";

type SortBy = "placement" | "group" | "avg_sr";
type SortOrder = "asc" | "desc";

/**
 * One control for both sort key and direction — it used to be two selects.
 * `as const` keeps the message keys literal so next-intl can type-check them.
 */
const SORT_OPTIONS = [
  { by: "avg_sr", order: "asc", fieldKey: "teams.sortAvgSr", orderKey: "common.ascending" },
  { by: "avg_sr", order: "desc", fieldKey: "teams.sortAvgSr", orderKey: "common.descending" },
  { by: "placement", order: "asc", fieldKey: "teams.sortPlacement", orderKey: "common.ascending" },
  {
    by: "placement",
    order: "desc",
    fieldKey: "teams.sortPlacement",
    orderKey: "common.descending"
  },
  { by: "group", order: "asc", fieldKey: "teams.sortGroup", orderKey: "common.ascending" },
  { by: "group", order: "desc", fieldKey: "teams.sortGroup", orderKey: "common.descending" }
] as const satisfies readonly {
  by: SortBy;
  order: SortOrder;
  fieldKey: string;
  orderKey: string;
}[];

const SORT_BY_VALUES: readonly SortBy[] = ["avg_sr", "placement", "group"];

const parseId = (value: string | null) => {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

// Starts at one column: the ladder used to open on `grid-cols-2` below the 320px
// `xs` breakpoint, which no viewport can reach.
const TEAM_GRID = "grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-8 xl:grid-cols-3";

const TeamsPage = () => {
  const t = useTranslations();
  const { searchParams, setParams } = useQueryParams({ resetOnChange: [] });

  const tournamentId = parseId(searchParams.get("tournamentId"));
  const search = searchParams.get("q") ?? "";
  const requestedSort = searchParams.get("sort") as SortBy | null;
  const sortBy: SortBy =
    requestedSort && SORT_BY_VALUES.includes(requestedSort) ? requestedSort : "avg_sr";
  const sortOrder: SortOrder = searchParams.get("order") === "desc" ? "desc" : "asc";

  const {
    data: tournamentsData,
    isSuccess: isSuccessTournaments,
    isLoading: loadingTournaments,
    isError: isErrorTournaments,
    refetch: refetchTournaments
  } = useQuery({
    queryKey: ["tournaments"],
    queryFn: () => tournamentService.getAll()
  });

  const {
    data: teamsData,
    isLoading: teamsLoading,
    isError: isErrorTeams,
    refetch: refetchTeams
  } = useQuery({
    queryKey: ["teams", tournamentId, sortBy, sortOrder],
    queryFn: () =>
      teamService.getAll({ tournamentId: tournamentId as number, sort: sortBy, order: sortOrder }),
    enabled: tournamentId != null
  });

  const firstTournamentId = tournamentsData?.results?.[0]?.id;

  useEffect(() => {
    if (tournamentId == null && isSuccessTournaments && firstTournamentId) {
      setParams({ tournamentId: firstTournamentId });
    }
  }, [firstTournamentId, isSuccessTournaments, setParams, tournamentId]);

  const teams = useMemo(() => {
    const all = teamsData?.results ?? [];
    const query = search.trim().toLowerCase();
    if (!query) return all;
    return all.filter((team) => team.name.toLowerCase().includes(query));
  }, [teamsData?.results, search]);

  const isLoading = teamsLoading || loadingTournaments;
  const hasNoTeams = !isLoading && tournamentId != null && teams.length === 0;
  const isFiltered = search.trim() !== "";

  // One body per state, in priority order: a failed tournament list hides
  // everything downstream, and a missing selection has nothing to load yet.
  const renderTeams = () => {
    if (isErrorTournaments) {
      return (
        <PageStateCard
          state="error"
          description={t("teams.tournamentsLoadError")}
          onAction={() => void refetchTournaments()}
        />
      );
    }
    if (tournamentId == null && !loadingTournaments) {
      return <PageStateCard state="empty" description={t("teams.selectTournamentToView")} />;
    }
    if (isErrorTeams) {
      return (
        <PageStateCard
          state="error"
          description={t("teams.teamsLoadError")}
          onAction={() => void refetchTeams()}
        />
      );
    }
    if (hasNoTeams) {
      return (
        <PageStateCard
          state={isFiltered ? "filtered-empty" : "empty"}
          description={isFiltered ? undefined : t("teams.noTeamsFound")}
          onAction={isFiltered ? () => setParams({ q: null }) : undefined}
        />
      );
    }
    return (
      <div className={TEAM_GRID}>
        {isLoading
          ? Array.from({ length: 6 }).map((_, index) => <TournamentTeamCardSkeleton key={index} />)
          : teams.map((team) => <TournamentTeamCard key={team.id} team={team} />)}
      </div>
    );
  };

  return (
    <div className="liquid-glass flex flex-col gap-4 md:gap-8">
      <div className="sticky top-[var(--aqt-header-h)] z-40 -mx-4 px-4 pb-4 md:-mx-6 md:px-6 xl:-mx-10 xl:px-10">
        <Card className="overflow-hidden">
          <CardHeader className="p-4 pb-3">
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-semibold leading-none tracking-tight">
                {t("common.teams")}
              </h1>
              <p className="hidden text-sm text-muted-foreground sm:block">{t("teams.subtitle")}</p>
            </div>
          </CardHeader>

          <CardContent className="p-4 pt-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-end">
              <div className="grid gap-1">
                <span className="text-xs text-muted-foreground">{t("common.tournament")}</span>
                <Select
                  value={tournamentId?.toString()}
                  onValueChange={(value) => setParams({ tournamentId: value })}
                  disabled={loadingTournaments || isErrorTournaments}
                >
                  <SelectTrigger
                    aria-label={t("common.tournament")}
                    className="h-10 w-full cursor-pointer md:w-62.5"
                  >
                    <SelectValue
                      placeholder={
                        loadingTournaments
                          ? t("teams.loadingTournaments")
                          : isErrorTournaments
                            ? t("teams.tournamentsLoadError")
                            : t("teams.selectTournament")
                      }
                    />
                  </SelectTrigger>
                  <SelectContent className="liquid-glass-panel max-h-[min(var(--radix-select-content-available-height),20rem)]">
                    <SelectGroup>
                      {tournamentsData?.results.map((item) => (
                        <SelectItem key={item.id} value={item.id.toString()}>
                          {item.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>

              <SearchField
                showLabel
                value={search}
                onValueChange={(value) => setParams({ q: value })}
                label={t("teams.findTeam")}
                placeholder={t("teams.findTeam")}
                containerClassName="w-full md:w-62.5"
                className="h-10"
              />

              <div className="grid gap-1">
                <span className="text-xs text-muted-foreground">{t("common.sortBy")}</span>
                <Select
                  value={`${sortBy}:${sortOrder}`}
                  onValueChange={(value) => {
                    const [by, order] = value.split(":");
                    setParams({ sort: by, order });
                  }}
                >
                  <SelectTrigger
                    aria-label={t("common.sortBy")}
                    className="h-10 w-full cursor-pointer md:w-62.5"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="liquid-glass-panel">
                    {SORT_OPTIONS.map((option) => {
                      const value = `${option.by}:${option.order}`;
                      return (
                        <SelectItem key={value} value={value}>
                          {t("teams.sortValue", {
                            field: t(option.fieldKey),
                            order: t(option.orderKey)
                          })}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {renderTeams()}
    </div>
  );
};

const TeamsPageFallback = () => (
  <div className="liquid-glass flex flex-col gap-4 md:gap-8">
    <div className="-mx-4 px-4 md:-mx-6 md:px-6 xl:-mx-10 xl:px-10">
      <Card className="overflow-hidden">
        <CardHeader className="p-4 pb-3">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="hidden h-4 w-80 sm:block" />
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </CardContent>
      </Card>
    </div>

    <div className={TEAM_GRID}>
      {Array.from({ length: 6 }).map((_, index) => (
        <TournamentTeamCardSkeleton key={index} />
      ))}
    </div>
  </div>
);

const TeamsPageWrapper = () => (
  <Suspense fallback={<TeamsPageFallback />}>
    <TeamsPage />
  </Suspense>
);

export default TeamsPageWrapper;
