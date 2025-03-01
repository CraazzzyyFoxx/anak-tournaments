"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
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
import { Card } from "@/components/ui/card";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import RanksPage from "@/app/tournaments/analytics/components/RanksPage";
import tournamentService from "@/services/tournament.service";
import analyticsService from "@/services/analytics.service";

const AnalyticsPage = () => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [activeTournamentId, setActiveTournamentId] = useState<number | null>(null);
  const [previousElement, setPreviousElement] = useState<HTMLElement | null>(null);
  const [algorithm, setAlgorithm] = useState<number | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<string>("");
  const [activeTab, setActiveTab] = useState<string>("overview");

  const {
    data: tournamentsData,
    isSuccess: isSuccessTournaments,
    isLoading: loadingTournaments
  } = useQuery({
    queryKey: ["tournaments"],
    queryFn: () => tournamentService.getAll(false)
  });
  const { data: algorithmData, isSuccess: isSuccessAlgorithm } = useQuery({
    queryKey: ["analytics", "algorithms"],
    queryFn: () => analyticsService.getAlgorithms()
  });
  const { data: analytics, isLoading: teamsLoading } = useQuery({
    queryKey: ["analytics", activeTournamentId, algorithm],
    // @ts-ignore
    queryFn: () => analyticsService.getAnalytics(activeTournamentId, algorithm),
    enabled: !!activeTournamentId && !!algorithm
  });

  useEffect(() => {
    const newSearchParams = new URLSearchParams(searchParams);
    setActiveTournamentId(Number(newSearchParams.get("tournamentId")));
    setAlgorithm(Number(newSearchParams.get("algorithm")));
    setActiveTab(newSearchParams.get("tab") || "overview");
    if (!newSearchParams.has("tournamentId") && isSuccessTournaments) {
      newSearchParams.set("tournamentId", String(tournamentsData?.results[0].id));
      router.push(`${pathname}?${newSearchParams.toString()}`);
    }
    if (!newSearchParams.has("algorithm") && isSuccessAlgorithm) {
      newSearchParams.set("algorithm", String(algorithmData?.results[0].id));
      router.push(`${pathname}?${newSearchParams.toString()}`);
    }
  }, [
    pathname,
    router,
    searchParams,
    tournamentsData?.results,
    isSuccessTournaments,
    algorithmData?.results
  ]);

  useEffect(() => {
    setSelectedTeam("");
  }, [activeTournamentId]);

  const navToTab = useCallback(
    (tab: string) => {
      const newSearchParams = new URLSearchParams(searchParams || undefined);
      newSearchParams.set("tab", tab);
      router.push(`${pathname}?${newSearchParams.toString()}`);
      setActiveTab(tab);
    },
    [searchParams, pathname]
  );

  const pushTournamentId = (newTournamentId: string) => {
    if (!searchParams) return `${pathname}?$tournamentId=${newTournamentId}`;
    const newSearchParams = new URLSearchParams(searchParams);
    newSearchParams.set("tournamentId", String(newTournamentId));
    router.push(`${pathname}?${newSearchParams.toString()}`);
    setActiveTournamentId(Number(newTournamentId));
  };

  const pushAlgorithm = (newAlgorithm: string) => {
    if (!searchParams) return `${pathname}?$algorithm=${newAlgorithm}`;
    const newSearchParams = new URLSearchParams(searchParams);
    newSearchParams.set("algorithm", String(newAlgorithm));
    router.push(`${pathname}?${newSearchParams.toString()}`);
    setAlgorithm(Number(newAlgorithm));
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
    <Tabs defaultValue={activeTab}>
      <div className="flex xs:flex-col md:flex-row gap-4 pb-4">
        <TabsList className="grid grid-cols-3 xs:w-full md:w-[300px]">
          <TabsTrigger value="overview" onClick={() => navToTab("overview")}>
            Overview
          </TabsTrigger>
          <TabsTrigger value="teams" onClick={() => navToTab("teams")}>
            Teams
          </TabsTrigger>
          <TabsTrigger value={"ranks"} onClick={() => navToTab("ranks")}>
            Divs
          </TabsTrigger>
        </TabsList>
        <Select
          value={activeTournamentId?.toString()}
          onValueChange={(value) => pushTournamentId(value)}
        >
          <SelectTrigger className="xs:w-full md:w-[250px]">
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
        <Select value={algorithm?.toString()} onValueChange={(value) => pushAlgorithm(value)}>
          <SelectTrigger className="xs:w-full md:w-[250px]">
            <SelectValue placeholder="Select a algorithm" />
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
      <TabsContent value="overview" className="flex flex-col w-full">
        <div className="flex flex-col gap-8">
          <TeamComboBox
            teams={analytics?.teams || []}
            onSelect={scrollToTeam}
            selectedTeam={selectedTeam}
          />
          <TeamAnalyticsTable
            teams={analytics?.teams || []}
            isLoading={teamsLoading || loadingTournaments}
          />
        </div>
      </TabsContent>
      <TabsContent value="teams" className="grid gap-8 xs:grid-cols-1 lg:grid-cols-2">
        <Card>
          <ScrollArea>
            <Table>
              <TableHeader>
                <TableRow className="">
                  <TableHead className="text-center">Actual Place</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-center">Won matches</TableHead>
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
                      <TableCell className="text-center">{team.placement}</TableCell>
                      <TableCell>{team.name}</TableCell>
                      <TableCell className="text-center">
                        {analytics?.teams_wins[team.id]}
                      </TableCell>
                      <TableCell className="text-center">{team.group?.name}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </Card>
        <Card>
          <ScrollArea>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-center">Predicted place</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-center">Balancer shift</TableHead>
                  <TableHead className="text-center">Anak shift</TableHead>
                  <TableHead className="text-center">Total shift</TableHead>
                  <TableHead className="text-center">Actual place</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {analytics?.teams
                  .slice()
                  .sort((a, b) => a.total_shift - b.total_shift || a.name.localeCompare(b.name))
                  .map((team, index) => {
                    let color = "bg-background";
                    // @ts-ignore
                    if (Math.abs(team.placement - (index + 1)) > 10)
                      color = "bg-[#f1ac9d] text-black hover:hover:bg-red-400";

                    return (
                      <TableRow key={team.id} className={color}>
                        <TableCell className="text-center">{index + 1}</TableCell>
                        <TableCell>{team.name}</TableCell>
                        <TableCell className="text-center">{team.balancer_shift}</TableCell>
                        <TableCell className="text-center">{team.manual_shift}</TableCell>
                        <TableCell className="text-center">{team.total_shift}</TableCell>
                        <TableCell className="text-center">{team.placement}</TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </Card>
      </TabsContent>
      <TabsContent value={"ranks"}>
        <RanksPage />
      </TabsContent>
    </Tabs>
  );
};

const AnalyticsPageWrapper = () => (
  <Suspense fallback={<div>Loading...</div>}>
    <AnalyticsPage />
  </Suspense>
);

export default AnalyticsPageWrapper;
