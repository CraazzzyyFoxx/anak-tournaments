import React from "react";

import StatisticsCard from "@/components/StatisticsCard";
import TournamentsChart from "@/components/TournamentsChart";
import TournamentsDivisionChart from "@/components/TournamentsDivisionChart";
import ChampionsTable from "@/components/ChampionsTable";
import TopWinratePlayersTable from "@/components/TopWinratePlayersTable";
import HeroPlaytimeChart from "@/components/HeroPlaytimeChart";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import statisticsService from "@/services/statistics.service";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import heroService from "@/services/hero.service";

export default async function Home() {
  const overall = await statisticsService.getOverallStatistics();
  const tournaments = await statisticsService.getTournaments();
  const tournamentsDivision = await statisticsService.getTournamentsDivision();
  const hero_playtime = await heroService.getHeroPlaytime();

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 md:gap-8 lg:grid-cols-4">
        <StatisticsCard name="Tournaments Held" value={overall.tournaments} />
        <StatisticsCard name="Teams Balanced" value={overall.teams} />
        <StatisticsCard name="Players Participated" value={overall.players} />
        <StatisticsCard name="Champions" value={overall.champions} />
      </div>
      <div className="grid gap-4 md:gap-8 lg:grid-cols-2 xl:grid-cols-4">
        <div className="col-span-2">
          <TournamentsChart data={tournaments} />
        </div>
        <div className="col-span-2">
          <TournamentsDivisionChart data={tournamentsDivision} />
        </div>
      </div>
      <div className="grid gap-4 md:gap-8 xl:grid-cols-4 lg:grid-cols-2 xs:grid-cols-1">
        <ScrollArea>
          <ChampionsTable />
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
        <ScrollArea>
          <TopWinratePlayersTable />
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Popular Heroes</CardTitle>
          </CardHeader>
          <div className="p-0 pb-2">
            <HeroPlaytimeChart heroes={hero_playtime.results} />
          </div>
        </Card>
      </div>
    </>
  );
}
