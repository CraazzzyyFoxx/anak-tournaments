"use client";


import React, { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import tournamentService from "@/services/tournament.service";
import { Team } from "@/types/team.types";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import TeamComboBox from "@/components/TeamComboBox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import TeamAnalyticsTable from "@/app/tournaments/analytics/components/TeamAnalyticsTable";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card } from "@/components/ui/card";

const AnalyticsPage = () => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // const [sortBy, setSortBy] = useState<"placement" | "group" | "avg_sr">("avg_sr");
  // const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [activeTournamentId, setActiveTournamentId] = useState<number | null>(null);
  const [previousElement, setPreviousElement] = useState<HTMLElement | null>(null);
  const [selectedTeam, setSelectedTeam] = React.useState<string>("");

  const { data: tournamentsData, isSuccess: isSuccessTournaments, isLoading: loadingTournaments } = useQuery({
    queryKey: ["tournaments"],
    queryFn: () => tournamentService.getAll()
  });
  const { data: analytics, isLoading: teamsLoading } = useQuery({
    queryKey: ["tournaments", "analytics", activeTournamentId],
    // @ts-ignore
    queryFn: () => tournamentService.getAnalytics(activeTournamentId),
    enabled: !!activeTournamentId
  });

  useEffect(() => {
    const newSearchParams = new URLSearchParams(searchParams);
    setActiveTournamentId(Number(newSearchParams.get("tournamentId")));
    if (!newSearchParams.has("tournamentId") && isSuccessTournaments) {
      newSearchParams.set("tournamentId", String(tournamentsData?.results[0].id));
      router.push(`${pathname}?${newSearchParams.toString()}`);
    }
  }, [pathname, router, searchParams, tournamentsData?.results, isSuccessTournaments]);

  useEffect(() => {
    setSelectedTeam("");
  }, [activeTournamentId]);

  const pushTournamentId = (newTournamentId: string) => {
    if (!searchParams) return `${pathname}?$tournamentId=${newTournamentId}`;
    const newSearchParams = new URLSearchParams(searchParams);
    newSearchParams.set("tournamentId", String(newTournamentId));
    router.push(`${pathname}?${newSearchParams.toString()}`);
    setActiveTournamentId(Number(newTournamentId));
  };

  const scrollToTeam = (team: Team) => {
    setSelectedTeam(team.name);
    setTimeout(() => {
      const element = document.getElementById(team.id.toString());
      previousElement?.classList.remove("bg-slate-800");
      setPreviousElement(element);
      if (element) {
        const offset = 50;
        const bodyRect = document.body.getBoundingClientRect().top;
        const elementRect = element.getBoundingClientRect().top;
        const elementPosition = elementRect - bodyRect;
        const offsetPosition = elementPosition - offset;

        window.scrollTo({
          top: offsetPosition,
          behavior: "smooth"
        });
        element.classList.add("bg-slate-800");
      }
    }, 250);
  };

  return (
    <div className="flex flex-col gap-8">
      <Select
        value={activeTournamentId?.toString()}
        onValueChange={(value) => pushTournamentId(value)}
      >
        <SelectTrigger className="w-[250px]">
          <SelectValue placeholder="Select a tournemnt" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {tournamentsData?.results.map((item) => (
              <SelectItem key={item.id} value={item.id.toString()}>
                {item.name}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <Tabs defaultValue="overview">
        <TabsList className="grid grid-cols-2 w-[400px] mb-8">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="teams">Teams</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="flex flex-col w-full">
          <div className="flex flex-col gap-8">
            <TeamComboBox
              teams={analytics?.teams || []}
              onSelect={scrollToTeam}
              selectedTeam={selectedTeam}
            />
            <TeamAnalyticsTable teams={analytics?.teams || []} isLoading={teamsLoading || loadingTournaments} />
          </div>
        </TabsContent>
        <TabsContent value="teams" className="flex gap-8">
          <Card>
            <Table>
              <TableHeader>
                <TableRow className="">
                  <TableHead>Actual Place</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Won matches</TableHead>
                  <TableHead>Group</TableHead>
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
                      <TableCell>{team.placement}</TableCell>
                      <TableCell>{team.name}</TableCell>
                      <TableCell>{analytics?.teams_wins[team.id]}</TableCell>
                      <TableCell>{team.group?.name}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </Card>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Predicted place</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Balancer shift</TableHead>
                  <TableHead>Anak shift</TableHead>
                  <TableHead>Total shift</TableHead>
                  <TableHead>Actual place</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {analytics?.teams.slice().sort((a, b) => a.total_shift - b.total_shift).map((team, index) => {
                  let color = "bg-background";
                  // @ts-ignore
                  if (Math.abs(team.placement - (index + 1)) > 10) color = "bg-[#f1ac9d] text-black";

                  return (
                    <TableRow key={team.id} className={color}>
                      <TableCell>{index + 1}</TableCell>
                      <TableCell>{team.name}</TableCell>
                      <TableCell>{team.balancer_shift}</TableCell>
                      <TableCell>{team.manual_shift}</TableCell>
                      <TableCell>{team.total_shift}</TableCell>
                      <TableCell>{team.placement}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

const AnalyticsPageWrapper = () => (
  <Suspense fallback={<div>Loading...</div>}>
    <AnalyticsPage />
  </Suspense>
);

export default AnalyticsPageWrapper;