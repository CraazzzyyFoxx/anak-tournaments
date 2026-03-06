"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Team } from "@/types/team.types";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import TeamComboBox from "@/components/TeamComboBox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import TeamAnalyticsTable from "@/app/tournaments/analytics/components/TeamAnalyticsTable";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import RanksPage from "@/app/tournaments/analytics/components/RanksPage";
import tournamentService from "@/services/tournament.service";
import analyticsService from "@/services/analytics.service";

const AnalyticsPage = () => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [previousElement, setPreviousElement] = useState<HTMLElement | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<string>("");

  const parseId = useCallback((value: string | null) => {
    if (!value) return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
  }, []);

  const tournamentId = useMemo(() => {
    return parseId(searchParams.get("tournamentId"));
  }, [parseId, searchParams]);

  const algorithmId = useMemo(() => {
    return parseId(searchParams.get("algorithm"));
  }, [parseId, searchParams]);

  const activeTab = useMemo(() => {
    const tab = searchParams.get("tab");
    if (tab === "teams" || tab === "ranks") return tab;
    return "overview";
  }, [searchParams]);

  const {
    data: tournamentsData,
    isSuccess: isSuccessTournaments,
    isLoading: loadingTournaments,
    isError: isErrorTournaments
  } = useQuery({
    queryKey: ["tournaments"],
    queryFn: () => tournamentService.getAll(false)
  });
  const {
    data: algorithmData,
    isSuccess: isSuccessAlgorithm,
    isLoading: loadingAlgorithms,
    isError: isErrorAlgorithms
  } = useQuery({
    queryKey: ["analytics", "algorithms"],
    queryFn: () => analyticsService.getAlgorithms()
  });
  const canQueryAnalytics = tournamentId != null && algorithmId != null;

  const {
    data: analytics,
    isLoading: loadingAnalytics,
    isError: isErrorAnalytics
  } = useQuery({
    queryKey: ["analytics", tournamentId, algorithmId],
    // @ts-ignore
    queryFn: () => analyticsService.getAnalytics(tournamentId, algorithmId),
    enabled: canQueryAnalytics
  });

  const activeTournament = useMemo(() => {
    if (!tournamentId) return null;
    return tournamentsData?.results?.find((t) => t.id === tournamentId) || null;
  }, [tournamentId, tournamentsData?.results]);

  const activeAlgorithm = useMemo(() => {
    if (!algorithmId) return null;
    return algorithmData?.results?.find((a) => a.id === algorithmId) || null;
  }, [algorithmId, algorithmData?.results]);

  useEffect(() => {
    const nextParams = new URLSearchParams(searchParams);
    let changed = false;

    const tab = nextParams.get("tab");
    if (tab && tab !== "overview" && tab !== "teams" && tab !== "ranks") {
      nextParams.set("tab", "overview");
      changed = true;
    }

    if (tournamentId == null && isSuccessTournaments && tournamentsData?.results?.[0]?.id) {
      nextParams.set("tournamentId", String(tournamentsData.results[0].id));
      changed = true;
    }

    if (algorithmId == null && isSuccessAlgorithm && algorithmData?.results?.[0]?.id) {
      nextParams.set("algorithm", String(algorithmData.results[0].id));
      changed = true;
    }

    if (changed) {
      router.replace(`${pathname}?${nextParams.toString()}`);
    }
  }, [
    pathname,
    router,
    searchParams,
    isSuccessTournaments,
    tournamentsData?.results,
    isSuccessAlgorithm,
    algorithmData?.results,
    tournamentId,
    algorithmId
  ]);

  useEffect(() => {
    setSelectedTeam("");
    setPreviousElement((el) => {
      el?.classList.remove("ring-2", "ring-ring", "ring-offset-2", "ring-offset-background");
      return null;
    });
  }, [tournamentId]);

  const navToTab = useCallback(
    (tab: string) => {
      const newSearchParams = new URLSearchParams(searchParams || undefined);
      newSearchParams.set("tab", tab);
      router.push(`${pathname}?${newSearchParams.toString()}`);
    },
    [router, searchParams, pathname]
  );

  const pushTournamentId = (newTournamentId: string) => {
    const newSearchParams = new URLSearchParams(searchParams || undefined);
    newSearchParams.set("tournamentId", String(newTournamentId));
    router.push(`${pathname}?${newSearchParams.toString()}`);
  };

  const pushAlgorithm = (newAlgorithm: string) => {
    const newSearchParams = new URLSearchParams(searchParams || undefined);
    newSearchParams.set("algorithm", String(newAlgorithm));
    router.push(`${pathname}?${newSearchParams.toString()}`);
  };

  const scrollToTeam = (team: Team) => {
    setSelectedTeam(team.name);
    setTimeout(() => {
      const element = document.getElementById(team.id.toString());
      previousElement?.classList.remove(
        "ring-2",
        "ring-ring",
        "ring-offset-2",
        "ring-offset-background"
      );
      setPreviousElement(element);
      if (element) {
        const offset = 124;
        const bodyRect = document.body.getBoundingClientRect().top;
        const elementRect = element.getBoundingClientRect().top;
        const elementPosition = elementRect - bodyRect;
        const offsetPosition = elementPosition - offset;

        window.scrollTo({
          top: offsetPosition,
          behavior: "smooth"
        });
        element.classList.add("ring-2", "ring-ring", "ring-offset-2", "ring-offset-background");
      }
    }, 250);
  };

  const isFiltersReady = !loadingTournaments && !loadingAlgorithms;
  const isAnalyticsReady = canQueryAnalytics && !!analytics;
  const isEmptyTeams = isAnalyticsReady && (analytics?.teams?.length || 0) === 0;

  return (
    <Tabs value={activeTab} onValueChange={navToTab} className="liquid-glass">
      <div className="sticky top-14 z-40 -mx-4 md:-mx-6 xl:-mx-10 px-4 md:px-6 xl:px-10 pb-4">
        <Card className="overflow-hidden">
          <CardHeader className="p-4 pb-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex flex-col gap-1">
                <h1 className="text-2xl font-semibold leading-none tracking-tight">Analytics</h1>
                <p className="text-sm text-muted-foreground hidden sm:block">
                  Tournament overview, team standings, and division shift tables.
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-start gap-2 sm:justify-end">
                {loadingTournaments ? (
                  <Skeleton className="h-6 w-56" />
                ) : activeTournament ? (
                  <Badge variant="secondary" className="max-w-88 truncate">
                    {activeTournament.name}
                  </Badge>
                ) : null}

                {loadingAlgorithms ? (
                  <Skeleton className="h-6 w-40" />
                ) : activeAlgorithm ? (
                  <Badge variant="outline" className="max-w-[18rem] truncate">
                    {activeAlgorithm.name}
                  </Badge>
                ) : null}
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-4 pt-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <TabsList className="grid grid-cols-3 w-full md:w-[320px]">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="teams">Teams</TabsTrigger>
                <TabsTrigger value="ranks">Divisions</TabsTrigger>
              </TabsList>

              <div className="grid gap-3 xs:grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-end">
                <div className="grid gap-1">
                  <span className="text-xs text-muted-foreground">Tournament</span>
                  <Select
                    value={tournamentId?.toString()}
                    onValueChange={(value) => pushTournamentId(value)}
                    disabled={loadingTournaments || isErrorTournaments}
                  >
                    <SelectTrigger
                      aria-label="Tournament"
                      className="h-10 cursor-pointer xs:w-full md:w-62.5"
                    >
                      <SelectValue
                        placeholder={
                          loadingTournaments
                            ? "Loading tournaments..."
                            : isErrorTournaments
                              ? "Failed to load tournaments"
                              : "Select a tournament"
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

                <div className="grid gap-1">
                  <span className="text-xs text-muted-foreground">Algorithm</span>
                  <Select
                    value={algorithmId?.toString()}
                    onValueChange={(value) => pushAlgorithm(value)}
                    disabled={loadingAlgorithms || isErrorAlgorithms}
                  >
                    <SelectTrigger
                      aria-label="Algorithm"
                      className="h-10 cursor-pointer xs:w-full md:w-62.5"
                    >
                      <SelectValue
                        placeholder={
                          loadingAlgorithms
                            ? "Loading algorithms..."
                            : isErrorAlgorithms
                              ? "Failed to load algorithms"
                              : "Select an algorithm"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {algorithmData?.results.map((item) => (
                          <SelectItem key={item.id} value={item.id.toString()}>
                            {item.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>

                {activeTab === "overview" ? (
                  <div className="grid gap-1 sm:col-span-2">
                    <span className="text-xs text-muted-foreground">Jump to team</span>
                    {!canQueryAnalytics || loadingAnalytics ? (
                      <Skeleton className="h-10 xs:w-full md:w-62.5" />
                    ) : (
                        <TeamComboBox
                          teams={analytics?.teams || []}
                          onSelect={scrollToTeam}
                          selectedTeam={selectedTeam}
                          variant="glass"
                        />
                      )}
                    </div>
                  ) : null}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <TabsContent value="overview" className="mt-0 pt-6 flex flex-col w-full">
        {!isFiltersReady ? (
          <div className="grid gap-4 md:gap-8 md:grid-cols-2 xl:grid-cols-3">
            <Skeleton className="h-105 w-full rounded-xl" />
            <Skeleton className="h-105 w-full rounded-xl" />
            <Skeleton className="h-105 w-full rounded-xl" />
          </div>
        ) : tournamentId == null || algorithmId == null ? (
          <Card>
            <CardHeader>
              <CardTitle>Choose parameters</CardTitle>
              <CardDescription>Select a tournament and an algorithm to view analytics.</CardDescription>
            </CardHeader>
          </Card>
        ) : isErrorAnalytics ? (
          <Card>
            <CardHeader>
              <CardTitle>Analytics unavailable</CardTitle>
              <CardDescription>Failed to load analytics for the selected parameters.</CardDescription>
            </CardHeader>
          </Card>
        ) : isEmptyTeams ? (
          <Card>
            <CardHeader>
              <CardTitle>No teams</CardTitle>
              <CardDescription>No teams found for the selected tournament.</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <TeamAnalyticsTable teams={analytics?.teams || []} isLoading={loadingAnalytics} />
        )}
      </TabsContent>

      <TabsContent value="teams" className="mt-0 pt-6 grid gap-4 md:gap-8 xs:grid-cols-1 lg:grid-cols-2">
        {!isFiltersReady || !canQueryAnalytics || loadingAnalytics ? (
          <>
            <Card>
              <CardHeader>
                <Skeleton className="h-6 w-56" />
                <Skeleton className="h-4 w-72" />
              </CardHeader>
              <CardContent className="space-y-3">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-[92%]" />
                <Skeleton className="h-8 w-[96%]" />
                <Skeleton className="h-8 w-[90%]" />
                <Skeleton className="h-8 w-[95%]" />
                <Skeleton className="h-8 w-[88%]" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <Skeleton className="h-6 w-60" />
                <Skeleton className="h-4 w-72" />
              </CardHeader>
              <CardContent className="space-y-3">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-[92%]" />
                <Skeleton className="h-8 w-[96%]" />
                <Skeleton className="h-8 w-[90%]" />
                <Skeleton className="h-8 w-[95%]" />
                <Skeleton className="h-8 w-[88%]" />
              </CardContent>
            </Card>
          </>
        ) : isErrorAnalytics ? (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Analytics unavailable</CardTitle>
              <CardDescription>Failed to load analytics for the selected parameters.</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Actual standings</CardTitle>
                <CardDescription>Placement, wins, and group for each team.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-center">Place</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead className="text-center">Wins</TableHead>
                        <TableHead className="text-center">Group</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {analytics?.teams.map((team) => {
                        let color = "text-group-a";

                        if (team.group?.name == "B") color = "text-group-b";
                        if (team.group?.name == "C") color = "text-group-c";
                        if (team.group?.name == "D") color = "text-group-d";

                        return (
                          <TableRow key={team.id} className={color}>
                            <TableCell className="text-center tabular-nums">
                              {team.placement}
                            </TableCell>
                            <TableCell className="min-w-0">
                              <span className="block truncate" title={team.name}>
                                {team.name}
                              </span>
                            </TableCell>
                            <TableCell className="text-center tabular-nums">
                              {analytics?.teams_wins[team.id]}
                            </TableCell>
                            <TableCell className="text-center tabular-nums">
                              {team.group?.name}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                  <ScrollBar orientation="horizontal" />
                </ScrollArea>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Predicted vs actual</CardTitle>
                <CardDescription>
                  Sorted by total shift. Large mismatches are highlighted.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-center">Predicted</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead className="text-center">Balancer</TableHead>
                        <TableHead className="text-center">Anak</TableHead>
                        <TableHead className="text-center">Total</TableHead>
                        <TableHead className="text-center">Actual</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {analytics?.teams
                        .slice()
                        .sort(
                          (a, b) =>
                            a.total_shift - b.total_shift || a.name.localeCompare(b.name)
                        )
                        .map((team, index) => {
                          let rowClassName = "";
                          // @ts-ignore
                          if (Math.abs(team.placement - (index + 1)) > 10) {
                            rowClassName = "bg-destructive/15 hover:bg-destructive/20";
                          }

                          return (
                            <TableRow key={team.id} className={rowClassName}>
                              <TableCell className="text-center tabular-nums">
                                {index + 1}
                              </TableCell>
                              <TableCell className="min-w-0">
                                <span className="block truncate" title={team.name}>
                                  {team.name}
                                </span>
                              </TableCell>
                              <TableCell className="text-center tabular-nums">
                                {team.balancer_shift}
                              </TableCell>
                              <TableCell className="text-center tabular-nums">
                                {team.manual_shift}
                              </TableCell>
                              <TableCell className="text-center tabular-nums">
                                {team.total_shift}
                              </TableCell>
                              <TableCell className="text-center tabular-nums">
                                {team.placement}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                    </TableBody>
                  </Table>
                  <ScrollBar orientation="horizontal" />
                </ScrollArea>
              </CardContent>
            </Card>
          </>
        )}
      </TabsContent>

      <TabsContent value={"ranks"} className="mt-0 pt-6">
        <RanksPage />
      </TabsContent>
    </Tabs>
  );
};

const AnalyticsPageFallback = () => {
  return (
    <div className="flex flex-col gap-4 md:gap-8">
      <div className="liquid-glass">
        <Card className="overflow-hidden">
          <CardHeader className="p-4 pb-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex flex-col gap-2">
                <Skeleton className="h-8 w-44" />
                <Skeleton className="hidden sm:block h-4 w-80" />
              </div>
              <div className="flex flex-wrap gap-2">
                <Skeleton className="h-6 w-56" />
                <Skeleton className="h-6 w-40" />
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-4 pt-3">
            <div className="grid gap-3 md:grid-cols-3">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:gap-8 md:grid-cols-2 xl:grid-cols-3">
        <Skeleton className="h-[420px] w-full rounded-xl" />
        <Skeleton className="h-[420px] w-full rounded-xl" />
        <Skeleton className="h-[420px] w-full rounded-xl" />
      </div>
    </div>
  );
};

const AnalyticsPageWrapper = () => (
  <Suspense fallback={<AnalyticsPageFallback />}>
    <AnalyticsPage />
  </Suspense>
);

export default AnalyticsPageWrapper;
