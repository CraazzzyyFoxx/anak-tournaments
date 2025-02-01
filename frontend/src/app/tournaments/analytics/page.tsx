"use client";


import React, { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import tournamentService from "@/services/tournament.service";
import teamService from "@/services/team.service";
import { Team } from "@/types/team.types";
import TeamAnalyticsTable from "@/app/tournaments/analytics/components/TeamAnalyticsTable";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import TeamComboBox from "@/components/TeamComboBox";

const AnalyticsPage = () => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [sortBy, setSortBy] = useState<"placement" | "group" | "avg_sr">("avg_sr");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [activeTournamentId, setActiveTournamentId] = useState<number | null>(null);
  const [previousElement, setPreviousElement] = useState<HTMLElement | null>(null);
  const [selectedTeam, setSelectedTeam] = React.useState<string>("");

  const { data: tournamentsData, isSuccess: isSuccessTournaments } = useQuery({
    queryKey: ["tournaments"],
    queryFn: () => tournamentService.getAll()
  });
  const { data: teamsData, isLoading: teamsLoading } = useQuery({
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
      <div>
        <div className="flex gap-4">
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
          <TeamComboBox
            teams={teamsData || []}
            onSelect={scrollToTeam}
            selectedTeam={selectedTeam}
          />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-8">
        {
          teamsData?.map((team) => (
            <TeamAnalyticsTable key={team.name} team={team} />
          ))
        }
      </div>
    </div>
  );
};

export default AnalyticsPage;