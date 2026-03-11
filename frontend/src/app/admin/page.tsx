"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Gamepad2,
  Layers3,
  Map,
  Shield,
  Swords,
  Trophy,
  UserCircle,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { customFetch } from "@/lib/custom_fetch";
import { usePermissions } from "@/hooks/usePermissions";
import adminService from "@/services/admin.service";
import tournamentService from "@/services/tournament.service";
import type { Encounter } from "@/types/encounter.types";
import type { PaginatedResponse } from "@/types/pagination.types";
import type { Team } from "@/types/team.types";
import type { Tournament } from "@/types/tournament.types";
import type { User } from "@/types/user.types";

type DashboardSnapshot = {
  tournaments: Tournament[];
  teams: Team[];
  encounters: Encounter[];
  users: User[];
  heroes: number;
  gamemodes: number;
  maps: number;
};

function emptyPaginated<T>(): PaginatedResponse<T> {
  return {
    results: [],
    total: 0,
    page: 1,
    per_page: 0,
  };
}

function formatDate(value?: Date | string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
}

function DashboardStatCard({
  title,
  value,
  description,
  icon: Icon,
}: {
  title: string;
  value: string | number;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card className="border-border/70 bg-card/75 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardDescription>{title}</CardDescription>
          <div className="rounded-full border border-border/70 bg-background/80 p-2 text-muted-foreground">
            <Icon className="h-4 w-4" />
          </div>
        </div>
        <CardTitle className="text-3xl font-semibold tracking-tight">{value}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 text-sm text-muted-foreground">{description}</CardContent>
    </Card>
  );
}

export default function AdminDashboard() {
  const { hasPermission, isSuperuser } = usePermissions();
  const canReadUsers = hasPermission("user.read");
  const canReadHeroes = hasPermission("hero.read");
  const canReadGamemodes = hasPermission("gamemode.read");
  const canReadMaps = hasPermission("map.read");

  const dashboardQuery = useQuery({
    queryKey: ["admin", "dashboard", "command-center"],
    queryFn: async (): Promise<DashboardSnapshot> => {
      const [tournamentsData, teamsData, encountersData, usersData, heroesData, gamemodesData, mapsData] =
        await Promise.all([
          hasPermission("tournament.read") ? tournamentService.getAll(null) : Promise.resolve(emptyPaginated<Tournament>()),
          hasPermission("team.read")
            ? customFetch("teams", {
                query: {
                  page: 1,
                  per_page: -1,
                  entities: ["players", "tournament", "group"],
                },
              }).then((response) => response.json() as Promise<PaginatedResponse<Team>>)
            : Promise.resolve(emptyPaginated<Team>()),
          hasPermission("match.read")
            ? customFetch("encounters", {
                query: {
                  page: 1,
                  per_page: -1,
                  entities: ["tournament", "tournament_group"],
                },
              }).then((response) => response.json() as Promise<PaginatedResponse<Encounter>>)
            : Promise.resolve(emptyPaginated<Encounter>()),
          hasPermission("user.read")
            ? adminService.getUsers({ page: 1, per_page: -1 })
            : Promise.resolve(emptyPaginated<User>()),
          hasPermission("hero.read")
            ? adminService.getHeroes({ page: 1, per_page: -1 })
            : Promise.resolve(emptyPaginated<any>()),
          hasPermission("gamemode.read")
            ? adminService.getGamemodes({ page: 1, per_page: -1 })
            : Promise.resolve(emptyPaginated<any>()),
          hasPermission("map.read")
            ? adminService.getMaps({ page: 1, per_page: -1 })
            : Promise.resolve(emptyPaginated<any>()),
        ]);

      return {
        tournaments: tournamentsData.results ?? [],
        teams: teamsData.results ?? [],
        encounters: encountersData.results ?? [],
        users: usersData.results ?? [],
        heroes: heroesData.total ?? heroesData.results?.length ?? 0,
        gamemodes: gamemodesData.total ?? gamemodesData.results?.length ?? 0,
        maps: mapsData.total ?? mapsData.results?.length ?? 0,
      };
    },
  });

  const snapshot = dashboardQuery.data;

  const derived = useMemo(() => {
    const tournaments = snapshot?.tournaments ?? [];
    const teams = snapshot?.teams ?? [];
    const encounters = snapshot?.encounters ?? [];
    const users = snapshot?.users ?? [];

    const activeTournament = tournaments.find((item) => !item.is_finished) ?? tournaments[0] ?? null;
    const activeTournaments = tournaments.filter((item) => !item.is_finished).length;
    const tournamentsWithoutGroups = tournaments.filter((item) => (item.groups?.length ?? 0) === 0).length;
    const teamsWithoutPlayers = teams.filter((item) => (item.players?.length ?? 0) === 0).length;
    const players = teams.reduce((sum, team) => sum + (team.players?.length ?? 0), 0);
    const usersWithoutIdentities = users.filter(
      (user) =>
        (user.discord?.length ?? 0) + (user.battle_tag?.length ?? 0) + (user.twitch?.length ?? 0) === 0
    ).length;
    const encountersMissingLogs = encounters.filter((item) => !item.has_logs).length;

    const needsAttention = [
      activeTournaments === 0
        ? {
            title: "No active tournament",
            description: "Everything is marked finished. Create or reopen a tournament before the next operations cycle.",
            href: "/admin/tournaments",
            tone: "warning" as const,
          }
        : null,
      tournamentsWithoutGroups > 0
        ? {
            title: `${tournamentsWithoutGroups} tournament${tournamentsWithoutGroups > 1 ? "s" : ""} missing groups`,
            description: "Bracket and standings setup may be incomplete for current operations.",
            href: "/admin/tournaments",
            tone: "warning" as const,
          }
        : null,
      teamsWithoutPlayers > 0
        ? {
            title: `${teamsWithoutPlayers} teams without rosters`,
            description: "Balance, standings, and encounter setup will be brittle until each team has players.",
            href: "/admin/teams",
            tone: "warning" as const,
          }
        : null,
      encountersMissingLogs > 0
        ? {
            title: `${encountersMissingLogs} encounters missing logs`,
            description: "Analytics and hero reporting are incomplete for these matches.",
            href: "/admin/encounters",
            tone: "critical" as const,
          }
        : null,
      usersWithoutIdentities > 0
        ? {
            title: `${usersWithoutIdentities} player identities still unlinked`,
            description: "Link Discord, BattleTag, or Twitch handles to reduce ambiguity during admin workflows.",
            href: "/admin/users",
            tone: "info" as const,
          }
        : null,
    ].filter(Boolean);

    return {
      activeTournament,
      activeTournaments,
      tournamentsWithoutGroups,
      teamsWithoutPlayers,
      players,
      usersWithoutIdentities,
      encountersMissingLogs,
      needsAttention,
    };
  }, [snapshot]);

  if (dashboardQuery.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-56 rounded-3xl" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Skeleton className="h-36 rounded-2xl" />
          <Skeleton className="h-36 rounded-2xl" />
          <Skeleton className="h-36 rounded-2xl" />
          <Skeleton className="h-36 rounded-2xl" />
        </div>
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-3xl border border-border/70 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.12),transparent_38%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.10),transparent_32%)] p-6 shadow-sm sm:p-8">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="grid gap-8 xl:grid-cols-[1.15fr_0.85fr] xl:items-end">
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                Operations Command Center
              </Badge>
              <Badge variant="secondary" className="rounded-full px-3 py-1">
                Fortune-500 style admin shell
              </Badge>
            </div>

            <div className="space-y-3">
              <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
                Keep tournaments moving without losing operational context.
              </h1>
              <p className="max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">
                Use one command surface to watch active tournaments, spot roster and identity gaps, and route directly into the workflows that need action now.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button asChild>
                <Link href="/admin/tournaments">
                  <Trophy className="mr-2 h-4 w-4" />
                  Open Tournaments
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/admin/encounters">
                  <Swords className="mr-2 h-4 w-4" />
                  Review Encounters
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/admin/users">
                  <UserCircle className="mr-2 h-4 w-4" />
                  Player Identities
                </Link>
              </Button>
              {isSuperuser ? (
                <Button asChild variant="outline">
                  <Link href="/admin/access/users">
                    <Shield className="mr-2 h-4 w-4" />
                    Access Admin
                  </Link>
                </Button>
              ) : null}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <Card className="border-border/70 bg-card/80 shadow-sm">
              <CardHeader className="pb-3">
                <CardDescription>Active Tournament</CardDescription>
                <CardTitle className="text-xl">
                  {derived.activeTournament?.name ?? "No active tournament"}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                {derived.activeTournament ? (
                  <>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={derived.activeTournament.is_finished ? "outline" : "default"}>
                        {derived.activeTournament.is_finished ? "Finished" : "Active"}
                      </Badge>
                      <Badge variant="secondary">
                        {derived.activeTournament.is_league ? "League" : "Tournament"}
                      </Badge>
                    </div>
                    <p>
                      {formatDate(derived.activeTournament.start_date)} - {formatDate(derived.activeTournament.end_date)}
                    </p>
                    <Button asChild variant="outline" className="w-full justify-between">
                      <Link href={`/admin/tournaments/${derived.activeTournament.id}`}>
                        Open workspace
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </Button>
                  </>
                ) : (
                  <p>Create or reopen a tournament to repopulate the operations queue.</p>
                )}
              </CardContent>
            </Card>

            <Card className="border-border/70 bg-card/80 shadow-sm">
              <CardHeader className="pb-3">
                <CardDescription>Live Health Summary</CardDescription>
                <CardTitle className="text-xl">
                  {derived.needsAttention.length === 0 ? "Stable" : `${derived.needsAttention.length} issues`}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  <span>{snapshot?.heroes ?? 0} heroes, {snapshot?.gamemodes ?? 0} modes, {snapshot?.maps ?? 0} maps loaded</span>
                </div>
                <div className="flex items-center gap-2">
                  <CalendarDays className="h-4 w-4 text-sky-500" />
                  <span>{derived.activeTournaments} active tournaments in the current command view</span>
                </div>
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  <span>{derived.encountersMissingLogs} encounters missing logs</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <DashboardStatCard
          title="Tournaments"
          value={snapshot?.tournaments.length ?? 0}
          description={`${derived.activeTournaments} active, ${derived.tournamentsWithoutGroups} missing group setup`}
          icon={Trophy}
        />
        <DashboardStatCard
          title="Teams"
          value={snapshot?.teams.length ?? 0}
          description={`${derived.teamsWithoutPlayers} with empty rosters`}
          icon={Users}
        />
        <DashboardStatCard
          title="Players"
          value={derived.players}
          description={canReadUsers ? `${derived.usersWithoutIdentities} identities still unlinked` : "Identity coverage is hidden for this role"}
          icon={UserCircle}
        />
        <DashboardStatCard
          title="Encounters"
          value={snapshot?.encounters.length ?? 0}
          description={`${derived.encountersMissingLogs} missing logs for analytics`}
          icon={Swords}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <Card className="border-border/70 bg-card/75 shadow-sm">
          <CardHeader>
            <CardTitle>Needs Attention</CardTitle>
            <CardDescription>Operational issues surfaced from the current admin dataset.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {derived.needsAttention.length > 0 ? (
              derived.needsAttention.map((item) => (
                <Link
                  key={item.title}
                  href={item.href}
                  className="flex items-start justify-between gap-4 rounded-2xl border border-border/70 bg-background/60 p-4 transition-colors hover:bg-accent/30"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={item.tone === "critical" ? "destructive" : item.tone === "warning" ? "secondary" : "outline"}
                      >
                        {item.tone === "critical" ? "Critical" : item.tone === "warning" ? "Attention" : "Info"}
                      </Badge>
                      <span className="font-medium">{item.title}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">{item.description}</p>
                  </div>
                  <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              ))
            ) : (
              <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/5 p-4 text-sm text-muted-foreground">
                No urgent admin issues detected from the current tournament, roster, and encounter snapshot.
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-card/75 shadow-sm">
          <CardHeader>
            <CardTitle>Operational Lanes</CardTitle>
            <CardDescription>Fast access to the admin surfaces that teams use most often.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <Button asChild variant="outline" className="h-auto justify-between rounded-2xl px-4 py-4">
              <Link href="/admin/tournaments">
                <span className="flex items-center gap-3">
                  <Trophy className="h-4 w-4" />
                  Tournament control
                </span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" className="h-auto justify-between rounded-2xl px-4 py-4">
              <Link href="/admin/teams">
                <span className="flex items-center gap-3">
                  <Users className="h-4 w-4" />
                  Rosters and teams
                </span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" className="h-auto justify-between rounded-2xl px-4 py-4">
              <Link href="/admin/encounters">
                <span className="flex items-center gap-3">
                  <Swords className="h-4 w-4" />
                  Matches and logs
                </span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" className="h-auto justify-between rounded-2xl px-4 py-4">
              <Link href="/admin/standings">
                <span className="flex items-center gap-3">
                  <BarChart3 className="h-4 w-4" />
                  Standings health
                </span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            {hasPermission("user.read") ? (
              <Button asChild variant="outline" className="h-auto justify-between rounded-2xl px-4 py-4 sm:col-span-2">
                <Link href="/admin/users">
                  <span className="flex items-center gap-3">
                    <UserCircle className="h-4 w-4" />
                    Identity resolution and player mapping
                  </span>
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Card className="border-border/70 bg-card/75 shadow-sm">
          <CardHeader>
            <CardTitle>Content Inventory</CardTitle>
            <CardDescription>Game content and supporting datasets available to admin workflows.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
            {canReadHeroes ? (
              <div className="rounded-2xl border border-border/70 bg-background/60 p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Shield className="h-4 w-4 text-muted-foreground" /> Heroes
                </div>
                <div className="mt-2 text-2xl font-semibold">{snapshot?.heroes ?? 0}</div>
              </div>
            ) : null}
            {canReadGamemodes ? (
              <div className="rounded-2xl border border-border/70 bg-background/60 p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Gamepad2 className="h-4 w-4 text-muted-foreground" /> Modes
                </div>
                <div className="mt-2 text-2xl font-semibold">{snapshot?.gamemodes ?? 0}</div>
              </div>
            ) : null}
            {canReadMaps ? (
              <div className="rounded-2xl border border-border/70 bg-background/60 p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Map className="h-4 w-4 text-muted-foreground" /> Maps
                </div>
                <div className="mt-2 text-2xl font-semibold">{snapshot?.maps ?? 0}</div>
              </div>
            ) : null}
            {!canReadHeroes && !canReadGamemodes && !canReadMaps ? (
              <div className="rounded-2xl border border-border/70 bg-background/60 p-4 text-sm text-muted-foreground">
                Content inventory is hidden for this permission set.
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-card/75 shadow-sm">
          <CardHeader>
            <CardTitle>Latest Tournament Queue</CardTitle>
            <CardDescription>
              Recent tournaments loaded into the admin command center, newest first.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(snapshot?.tournaments ?? []).slice(0, 5).map((tournament) => (
              <Link
                key={tournament.id}
                href={`/admin/tournaments/${tournament.id}`}
                className="flex items-center justify-between gap-4 rounded-2xl border border-border/70 bg-background/60 p-4 transition-colors hover:bg-accent/30"
              >
                <div className="space-y-1">
                  <div className="font-medium">{tournament.name}</div>
                  <div className="text-sm text-muted-foreground">
                    {formatDate(tournament.start_date)} - {formatDate(tournament.end_date)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={tournament.is_finished ? "outline" : "default"}>
                    {tournament.is_finished ? "Finished" : "Active"}
                  </Badge>
                  <Badge variant="secondary">
                    <Layers3 className="mr-1 h-3 w-3" />
                    {tournament.groups?.length ?? 0}
                  </Badge>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
