import React, { Suspense } from "react";
import Link from "next/link";
import { Award, BarChart3, Scale, Trophy, Users } from "lucide-react";

import StatisticsCard from "@/components/StatisticsCard";
import TournamentsChart from "@/components/TournamentsChart";
import TournamentsDivisionChart from "@/components/TournamentsDivisionChart";
import ChampionsTable from "@/components/ChampionsTable";
import TopWinratePlayersTable from "@/components/TopWinratePlayersTable";
import HeroPlaytimeChart from "@/components/HeroPlaytimeChart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import statisticsService from "@/services/statistics.service";
import heroService from "@/services/hero.service";
import {
  ChartCardSkeleton,
  PopularHeroesCardSkeleton,
  StatsGridSkeleton,
  TableCardSkeleton
} from "@/app/home-skeletons";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <div className="space-y-8">
      {/* Header Section */}
      <div
        className="liquid-glass rounded-xl p-6 flex flex-col gap-6 md:flex-row md:items-center md:justify-between"
        style={
          {
            "--lg-a": "30 41 59",   // slate-800
            "--lg-b": "15 23 42",   // slate-900
            "--lg-c": "99 102 241"  // indigo-500
          } as React.CSSProperties
        }
      >
        <div className="flex flex-col gap-1.5">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Dashboard</h1>
          <p className="text-base text-muted-foreground max-w-lg">
            Complete overview of tournaments, player statistics, and performance trends.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button asChild size="lg" className="shadow-lg shadow-primary/20">
            <Link href="/tournaments">
              <Trophy className="mr-2 h-5 w-5" />
              Tournaments
            </Link>
          </Button>
          <Button asChild variant="secondary" size="lg">
            <Link href="/tournaments/analytics">
              <BarChart3 className="mr-2 h-5 w-5" />
              Analytics
            </Link>
          </Button>
        </div>
      </div>

      {/* Stats Overview */}
      <Suspense fallback={<StatsGridSkeleton />}>
        <StatsGrid />
      </Suspense>

      {/* Main Charts - Row 1 */}
      <div className="grid gap-6 md:gap-8 lg:grid-cols-2">
        <div
          className="liquid-glass rounded-xl h-full lg:col-span-1"
          style={
            {
              "--lg-a": "15 23 42",   // slate-900
              "--lg-b": "30 41 59",   // slate-800
              "--lg-c": "59 130 246"  // blue-500
            } as React.CSSProperties
          }
        >
          <Suspense fallback={<ChartCardSkeleton />}>
            <TournamentsChartCard />
          </Suspense>
        </div>

        <div
          className="liquid-glass rounded-xl h-full lg:col-span-1"
          style={
            {
              "--lg-a": "15 23 42",   // slate-900
              "--lg-b": "30 41 59",   // slate-800
              "--lg-c": "139 92 246"  // violet-500
            } as React.CSSProperties
          }
        >
          <Suspense fallback={<ChartCardSkeleton />}>
            <TournamentsDivisionChartCard />
          </Suspense>
        </div>
      </div>

      {/* Tables and Heroes - Row 2 */}
      <div className="grid gap-6 md:gap-8 lg:grid-cols-8">
        <div
          className="liquid-glass rounded-xl h-full lg:col-span-2"
          style={
            {
              "--lg-a": "15 23 42",   // slate-900
              "--lg-b": "30 41 59",   // slate-800
              "--lg-c": "16 185 129"  // emerald-500
            } as React.CSSProperties
          }
        >
          <Suspense fallback={<TableCardSkeleton />}>
            <ChampionsTableCard />
          </Suspense>
        </div>

        <div
          className="liquid-glass rounded-xl h-full lg:col-span-2"
          style={
            {
              "--lg-a": "15 23 42",   // slate-900
              "--lg-b": "30 41 59",   // slate-800
              "--lg-c": "245 158 11"  // amber-500
            } as React.CSSProperties
          }
        >
          <Suspense fallback={<TableCardSkeleton />}>
            <TopWinratePlayersTableCard />
          </Suspense>
        </div>

        <div
          className="liquid-glass rounded-xl h-full lg:col-span-4"
          style={
            {
              "--lg-a": "15 23 42",   // slate-900
              "--lg-b": "30 41 59",   // slate-800
              "--lg-c": "236 72 153"  // pink-500
            } as React.CSSProperties
          }
        >
          <Suspense fallback={<PopularHeroesCardSkeleton />}>
            <PopularHeroesCard />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

async function StatsGrid() {
  try {
    const overall = await statisticsService.getOverallStatistics();

    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatisticsCard
          name="Tournaments Held"
          value={overall.tournaments}
          icon={<Trophy className="h-4 w-4" />}
          iconClassName="bg-indigo-500/10 text-indigo-400"
        />
        <StatisticsCard
          name="Teams Balanced"
          value={overall.teams}
          icon={<Scale className="h-4 w-4" />}
          iconClassName="bg-blue-500/10 text-blue-400"
        />
        <StatisticsCard
          name="Players Participated"
          value={overall.players}
          icon={<Users className="h-4 w-4" />}
          iconClassName="bg-emerald-500/10 text-emerald-400"
        />
        <StatisticsCard
          name="Champions"
          value={overall.champions}
          icon={<Award className="h-4 w-4" />}
          iconClassName="bg-amber-500/10 text-amber-400"
        />
      </div>
    );
  } catch {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="md:col-span-2 lg:col-span-4 border-destructive/50">
          <CardHeader>
            <CardTitle>Overall statistics</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Failed to load overall statistics.
          </CardContent>
        </Card>
      </div>
    );
  }
}

async function TournamentsChartCard() {
  try {
    const tournaments = await statisticsService.getTournaments();
    return (
      <div className="bg-card/80 backdrop-blur-sm h-full rounded-xl w-full">
        <TournamentsChart data={tournaments} />
      </div>
    );
  } catch {
    return (
      <Card className="border-0 shadow-none bg-card/80 backdrop-blur-sm h-full">
        <CardHeader>
          <CardTitle>History of tournament changes</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Failed to load tournament history.
        </CardContent>
      </Card>
    );
  }
}

async function TournamentsDivisionChartCard() {
  try {
    const tournamentsDivision = await statisticsService.getTournamentsDivision();
    return (
      <div className="bg-card/80 backdrop-blur-sm h-full rounded-xl w-full">
        <TournamentsDivisionChart data={tournamentsDivision} />
      </div>
    );
  } catch {
    return (
      <Card className="border-0 shadow-none bg-card/80 backdrop-blur-sm h-full">
        <CardHeader>
          <CardTitle>Average division by roles</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Failed to load tournament division data.
        </CardContent>
      </Card>
    );
  }
}

async function ChampionsTableCard() {
  try {
    const champions = await statisticsService.getChampions();
    return (
      <div className="bg-card/80 backdrop-blur-sm rounded-xl h-full border-0">
        <ChampionsTable champions={champions.results} />
      </div>
    );
  } catch {
    return (
      <Card className="border-0 shadow-none bg-card/80 backdrop-blur-sm h-full">
        <CardHeader>
          <CardTitle>Champions</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">Failed to load champions.</CardContent>
      </Card>
    );
  }
}

async function TopWinratePlayersTableCard() {
  try {
    const players = await statisticsService.getTopWinratePlayers();
    return (
      <div className="bg-card/80 backdrop-blur-sm rounded-xl h-full border-0">
        <TopWinratePlayersTable players={players.results} />
      </div>
    );
  } catch {
    return (
      <Card className="border-0 shadow-none bg-card/80 backdrop-blur-sm h-full">
        <CardHeader>
          <CardTitle>Top Players by Win ratio</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Failed to load top players.
        </CardContent>
      </Card>
    );
  }
}

async function PopularHeroesCard() {
  try {
    const heroPlaytime = await heroService.getHeroPlaytime();

    return (
      <Card className="border-0 shadow-none bg-card/80 backdrop-blur-sm h-full">
        <CardHeader>
          <CardTitle>Popular Heroes</CardTitle>
        </CardHeader>
        <CardContent className="p-0 pb-2">
          <HeroPlaytimeChart heroes={heroPlaytime.results} />
        </CardContent>
      </Card>
    );
  } catch {
    return (
      <Card className="border-0 shadow-none bg-card/80 backdrop-blur-sm h-full">
        <CardHeader>
          <CardTitle>Popular Heroes</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Failed to load hero playtime.
        </CardContent>
      </Card>
    );
  }
}
