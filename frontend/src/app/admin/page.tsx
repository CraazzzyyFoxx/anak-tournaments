"use client";

import { type ComponentProps, useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Gamepad2,
  Layers3,
  Lock,
  Map,
  Shield,
  Swords,
  Trophy,
  UserCircle,
  Users,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { usePermissions } from "@/hooks/usePermissions";
import { customFetch } from "@/lib/custom_fetch";
import { cn } from "@/lib/utils";
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

type AttentionTone = "critical" | "warning" | "info";

type IssueItem = {
  label: string;
  count: number;
  href: string;
  tone: AttentionTone;
};

type LaneItem = {
  href: string;
  title: string;
  description: string;
  icon: LucideIcon;
};

function isDefined<T>(value: T | null): value is T {
  return value !== null;
}

function emptyPaginated<T>(): PaginatedResponse<T> {
  return { results: [], total: 0, page: 1, per_page: 0 };
}

function formatDate(value?: Date | string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString();
}

function SurfaceCard({ className, ...props }: ComponentProps<typeof Card>) {
  return (
    <Card
      data-ui="card"
      className={cn("rounded-[24px] border-border/60 bg-card/72 shadow-sm", className)}
      {...props}
    />
  );
}

function LockedState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-[20px] border border-dashed border-border/70 bg-background/45 p-5 text-sm text-muted-foreground">
      <div className="flex items-center gap-2 text-foreground">
        <Lock className="size-4 text-muted-foreground" />
        <span className="font-medium">{title}</span>
      </div>
      <p className="leading-6">{description}</p>
    </div>
  );
}

function IssueDot({ tone }: { tone: AttentionTone }) {
  return (
    <div
      className={cn(
        "mt-0.5 size-2 shrink-0 rounded-full",
        tone === "critical"
          ? "bg-destructive"
          : tone === "warning"
            ? "bg-amber-500"
            : "bg-muted-foreground/50",
      )}
    />
  );
}

function MiniStatCell({
  value,
  label,
  alert,
}: {
  value: number;
  label: string;
  alert?: boolean;
}) {
  return (
    <div className="rounded-[16px] border border-border/60 bg-background/45 p-3 text-center">
      <div
        className={cn(
          "text-2xl font-semibold tabular-nums",
          alert ? "text-destructive" : "text-foreground",
        )}
      >
        {value}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

export default function AdminDashboard() {
  const { hasPermission, isSuperuser } = usePermissions();

  const canReadTournaments = hasPermission("tournament.read");
  const canReadTeams = hasPermission("team.read");
  const canReadPlayers = hasPermission("player.read");
  const canReadMatches = hasPermission("match.read");
  const canReadStandings = hasPermission("standing.read");
  const canReadUsers = hasPermission("user.read");
  const canReadHeroes = hasPermission("hero.read");
  const canReadGamemodes = hasPermission("gamemode.read");
  const canReadMaps = hasPermission("map.read");

  const dashboardQuery = useQuery({
    queryKey: ["admin", "dashboard", "command-deck"],
    queryFn: async (): Promise<DashboardSnapshot> => {
      const [tournamentsData, teamsData, encountersData, usersData, heroesData, gamemodesData, mapsData] =
        await Promise.all([
          canReadTournaments
            ? tournamentService.getAll(null)
            : Promise.resolve(emptyPaginated<Tournament>()),
          canReadTeams
            ? customFetch("teams", {
                query: { page: 1, per_page: -1, entities: ["players", "tournament", "group"] },
              }).then((r) => r.json() as Promise<PaginatedResponse<Team>>)
            : Promise.resolve(emptyPaginated<Team>()),
          canReadMatches
            ? customFetch("encounters", {
                query: { page: 1, per_page: -1, entities: ["tournament", "tournament_group"] },
              }).then((r) => r.json() as Promise<PaginatedResponse<Encounter>>)
            : Promise.resolve(emptyPaginated<Encounter>()),
          canReadUsers
            ? adminService.getUsers({ page: 1, per_page: -1 })
            : Promise.resolve(emptyPaginated<User>()),
          canReadHeroes
            ? adminService.getHeroes({ page: 1, per_page: -1 })
            : Promise.resolve(emptyPaginated<never>()),
          canReadGamemodes
            ? adminService.getGamemodes({ page: 1, per_page: -1 })
            : Promise.resolve(emptyPaginated<never>()),
          canReadMaps
            ? adminService.getMaps({ page: 1, per_page: -1 })
            : Promise.resolve(emptyPaginated<never>()),
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

    const activeTournament =
      canReadTournaments
        ? (tournaments.find((t) => !t.is_finished) ?? tournaments[0] ?? null)
        : null;
    const activeTournaments = canReadTournaments
      ? tournaments.filter((t) => !t.is_finished).length
      : 0;
    const tournamentsWithoutGroups = canReadTournaments
      ? tournaments.filter((t) => (t.groups?.length ?? 0) === 0).length
      : 0;
    const teamsWithoutPlayers = canReadTeams
      ? teams.filter((t) => (t.players?.length ?? 0) === 0).length
      : 0;
    const players = canReadTeams
      ? teams.reduce((sum, team) => sum + (team.players?.length ?? 0), 0)
      : 0;
    const usersWithoutIdentities = canReadUsers
      ? users.filter(
          (u) =>
            (u.discord?.length ?? 0) + (u.battle_tag?.length ?? 0) + (u.twitch?.length ?? 0) === 0,
        ).length
      : 0;
    const encountersMissingLogs = canReadMatches
      ? encounters.filter((e) => !e.has_logs).length
      : 0;

    // Active tournament–scoped encounter stats
    const activeTournamentEncounters =
      activeTournament && canReadMatches
        ? encounters.filter((e) => e.tournament_id === activeTournament.id)
        : [];
    const activeTournamentMissingLogs = activeTournamentEncounters.filter((e) => !e.has_logs).length;
    const totalInTournament = activeTournamentEncounters.length;
    const logCoveragePercent =
      totalInTournament > 0
        ? Math.round(((totalInTournament - activeTournamentMissingLogs) / totalInTournament) * 100)
        : 100;

    const issueItems: IssueItem[] = [
      canReadMatches && encountersMissingLogs > 0
        ? {
            label: "Missing encounter logs",
            count: encountersMissingLogs,
            href: "/admin/encounters",
            tone: "critical" as AttentionTone,
          }
        : null,
      canReadTeams && teamsWithoutPlayers > 0
        ? {
            label: "Teams without rosters",
            count: teamsWithoutPlayers,
            href: "/admin/teams",
            tone: "warning" as AttentionTone,
          }
        : null,
      canReadTournaments && tournamentsWithoutGroups > 0
        ? {
            label: "Tournaments missing groups",
            count: tournamentsWithoutGroups,
            href: "/admin/tournaments",
            tone: "warning" as AttentionTone,
          }
        : null,
      canReadUsers && usersWithoutIdentities > 0
        ? {
            label: "Unlinked player identities",
            count: usersWithoutIdentities,
            href: "/admin/users",
            tone: "info" as AttentionTone,
          }
        : null,
    ].filter((item): item is IssueItem => item !== null);

    return {
      activeTournament,
      activeTournaments,
      tournamentsWithoutGroups,
      teamsWithoutPlayers,
      players,
      usersWithoutIdentities,
      encountersMissingLogs,
      activeTournamentEncounters,
      activeTournamentMissingLogs,
      logCoveragePercent,
      issueItems,
    };
  }, [snapshot, canReadMatches, canReadTeams, canReadTournaments, canReadUsers]);

  const operationalLanes: LaneItem[] = [
    canReadTournaments
      ? {
          href: "/admin/tournaments",
          title: "Tournament control",
          description: "Schedule windows, reopen events, and patch group setup.",
          icon: Trophy,
        }
      : null,
    canReadTeams
      ? {
          href: "/admin/teams",
          title: "Rosters and teams",
          description: "Audit lineup completeness and import health.",
          icon: Users,
        }
      : null,
    canReadPlayers
      ? {
          href: "/admin/players",
          title: "Player records",
          description: "Inspect player-level metadata and competition readiness.",
          icon: UserCircle,
        }
      : null,
    canReadMatches
      ? {
          href: "/admin/encounters",
          title: "Matches and logs",
          description: "Close the loop on encounter sync and log coverage.",
          icon: Swords,
        }
      : null,
    canReadStandings
      ? {
          href: "/admin/standings",
          title: "Standings health",
          description: "Validate rankings and surface recalculation risks.",
          icon: BarChart3,
        }
      : null,
    canReadUsers
      ? {
          href: "/admin/users",
          title: "Identity resolution",
          description: "Map account identities before they become operational noise.",
          icon: UserCircle,
        }
      : null,
    canReadHeroes
      ? {
          href: "/admin/heroes",
          title: "Hero catalog",
          description: "Keep hero data aligned with reporting and analytics.",
          icon: Shield,
        }
      : null,
    canReadGamemodes
      ? {
          href: "/admin/gamemodes",
          title: "Gamemode library",
          description: "Review rulesets and playable mode metadata.",
          icon: Gamepad2,
        }
      : null,
    canReadMaps
      ? {
          href: "/admin/maps",
          title: "Map pool",
          description: "Maintain map coverage used by tournaments and stats.",
          icon: Map,
        }
      : null,
    isSuperuser
      ? {
          href: "/admin/access/users",
          title: "Access and roles",
          description: "Govern who can touch what inside the admin shell.",
          icon: Shield,
        }
      : null,
  ].filter(isDefined);

  if (dashboardQuery.isLoading) {
    return (
      <div className="flex flex-col gap-5">
        <div className="grid gap-5 xl:grid-cols-[1.4fr_0.6fr]">
          <div className="flex flex-col gap-4">
            <Skeleton className="h-72 rounded-[24px]" />
            <Skeleton className="h-48 rounded-[24px]" />
          </div>
          <div className="flex flex-col gap-4">
            <Skeleton className="h-56 rounded-[24px]" />
            <Skeleton className="h-40 rounded-[24px]" />
            <Skeleton className="h-28 rounded-[24px]" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-[24px]" />
          ))}
        </div>
      </div>
    );
  }

  const activeTournament = derived.activeTournament;
  const completedInTournament =
    derived.activeTournamentEncounters.length - derived.activeTournamentMissingLogs;
  const hasContentInventory = canReadHeroes || canReadMaps || canReadGamemodes;

  return (
    <div className="flex flex-col gap-5">
      {/* ── FOCUS LAYOUT ─────────────────────────────────── */}
      <section className="grid gap-5 xl:grid-cols-[1.4fr_0.6fr]">

        {/* LEFT COLUMN */}
        <div className="flex flex-col gap-4">

          {/* TOURNAMENT HERO WIDGET */}
          <SurfaceCard className="overflow-hidden">
            {!canReadTournaments ? (
              <CardContent className="p-6 sm:p-7">
                <LockedState
                  title="Tournament data is hidden"
                  description="This role does not have visibility into tournament records from the dashboard."
                />
              </CardContent>
            ) : activeTournament ? (
              <>
                {/* Gradient header zone */}
                <div className="relative border-b border-border/40 px-6 pt-6 pb-5 sm:px-7 sm:pt-7">
                  <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-primary/3 to-transparent" />
                  <div className="relative flex flex-col gap-3">
                    {/* Context label */}
                    <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground/70">
                      {activeTournament.is_finished ? "Last Tournament" : "Active Tournament"}
                    </p>
                    {/* Badge row */}
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={activeTournament.is_finished ? "outline" : "default"}>
                        {activeTournament.is_finished ? "Finished" : "● Active"}
                      </Badge>
                      <Badge variant="secondary">
                        {activeTournament.is_league ? "League" : "Tournament"}
                      </Badge>
                    </div>
                    {/* Name */}
                    <h2 className="line-clamp-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                      {activeTournament.name}
                    </h2>
                    {/* Meta */}
                    <p className="text-sm text-muted-foreground">
                      {formatDate(activeTournament.start_date)} — {formatDate(activeTournament.end_date)}
                      {(activeTournament.groups?.length ?? 0) > 0 && (
                        <> · {activeTournament.groups.length} group{activeTournament.groups.length === 1 ? "" : "s"}</>
                      )}
                    </p>
                  </div>
                </div>

                {/* Stats + progress + CTAs */}
                <CardContent className="flex flex-col gap-4 px-6 pb-6 pt-5 sm:px-7">
                  {/* Mini stat cells */}
                  {canReadMatches ? (
                    <div className="grid grid-cols-3 gap-3">
                      <MiniStatCell value={activeTournament.groups?.length ?? 0} label="Groups" />
                      <MiniStatCell value={derived.activeTournamentEncounters.length} label="Encounters" />
                      <MiniStatCell
                        value={derived.activeTournamentMissingLogs}
                        label="Missing logs"
                        alert={derived.activeTournamentMissingLogs > 0}
                      />
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-3">
                      <MiniStatCell value={activeTournament.groups?.length ?? 0} label="Groups" />
                    </div>
                  )}

                  {/* Log coverage progress */}
                  {derived.activeTournamentEncounters.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Log coverage</span>
                        <span className="font-medium text-foreground">
                          {completedInTournament} / {derived.activeTournamentEncounters.length}{" "}
                          ({derived.logCoveragePercent}%)
                        </span>
                      </div>
                      <Progress value={derived.logCoveragePercent} className="h-1.5" />
                    </div>
                  )}

                  {/* CTA buttons */}
                  <div className="flex flex-wrap gap-2.5">
                    <Button asChild>
                      <Link href={`/admin/tournaments/${activeTournament.id}`}>
                        Open Workspace
                        <ArrowRight data-icon="inline-end" />
                      </Link>
                    </Button>
                    <Button asChild variant="outline">
                      <Link href="/admin/tournaments">All Tournaments</Link>
                    </Button>
                  </div>
                </CardContent>
              </>
            ) : (
              <CardContent className="p-6 sm:p-7">
                <div className="flex flex-col gap-4">
                  <p className="text-sm leading-6 text-muted-foreground">
                    No tournaments are currently active. Create or reopen a tournament to repopulate
                    the operations queue.
                  </p>
                  <Button asChild variant="outline" className="w-fit">
                    <Link href="/admin/tournaments">
                      Go to Tournaments
                      <ArrowRight data-icon="inline-end" />
                    </Link>
                  </Button>
                </div>
              </CardContent>
            )}
          </SurfaceCard>

          {/* RECENT TOURNAMENTS */}
          <SurfaceCard>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>Recent Tournaments</CardTitle>
                  <CardDescription className="mt-1">
                    Latest events in the admin queue
                  </CardDescription>
                </div>
                {canReadTournaments && (
                  <Button
                    asChild
                    variant="ghost"
                    size="sm"
                    className="-mt-1 shrink-0 text-muted-foreground"
                  >
                    <Link href="/admin/tournaments">
                      View all
                      <ArrowRight className="size-3.5" />
                    </Link>
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {canReadTournaments ? (
                (snapshot?.tournaments ?? []).length > 0 ? (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {(snapshot?.tournaments ?? []).slice(0, 6).map((t) => (
                      <Link
                        key={t.id}
                        href={`/admin/tournaments/${t.id}`}
                        className="rounded-[16px] border border-border/60 bg-background/45 p-3.5 transition-colors hover:bg-accent/30"
                      >
                        <div className="mb-1.5 truncate text-sm font-medium text-foreground">
                          {t.name}
                        </div>
                        <div className="mb-2.5 text-xs text-muted-foreground">
                          {formatDate(t.start_date)} — {formatDate(t.end_date)}
                        </div>
                        <div className="flex items-center justify-between">
                          <Badge variant={t.is_finished ? "outline" : "default"} className="text-xs">
                            {t.is_finished ? "Finished" : "Active"}
                          </Badge>
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Layers3 className="size-3" />
                            {t.groups?.length ?? 0}
                          </span>
                        </div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm leading-6 text-muted-foreground">
                    No tournaments are available in this admin view.
                  </p>
                )
              ) : (
                <LockedState
                  title="Tournament queue is hidden"
                  description="This role can use other admin surfaces, but tournament records are not visible from the dashboard."
                />
              )}
            </CardContent>
          </SurfaceCard>
        </div>

        {/* RIGHT COLUMN */}
        <div className="flex flex-col gap-4">

          {/* ISSUES QUEUE */}
          <SurfaceCard>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="flex size-7 items-center justify-center rounded-[10px] border border-border/60 bg-background/60">
                    <AlertTriangle className="size-3.5 text-muted-foreground" />
                  </div>
                  <CardTitle>Issues Queue</CardTitle>
                </div>
                {derived.issueItems.length > 0 && (
                  <Badge variant="destructive" className="tabular-nums">
                    {derived.issueItems.length}
                  </Badge>
                )}
              </div>
              <CardDescription>
                {derived.issueItems.length > 0
                  ? `${derived.issueItems.length} item${derived.issueItems.length === 1 ? "" : "s"} need${derived.issueItems.length === 1 ? "s" : ""} attention`
                  : "All clear — no issues surfaced"}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {derived.issueItems.length > 0 ? (
                derived.issueItems.map((item) => (
                  <Link
                    key={item.label}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 rounded-[14px] border px-4 py-3 transition-colors hover:bg-accent/30",
                      item.tone === "critical"
                        ? "border-destructive/30 bg-destructive/5"
                        : item.tone === "warning"
                          ? "border-amber-500/25 bg-amber-500/5"
                          : "border-border/60 bg-background/45",
                    )}
                  >
                    <IssueDot tone={item.tone} />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-sm font-medium leading-snug text-foreground">
                        {item.label}
                      </span>
                      <span className="text-xs capitalize text-muted-foreground">{item.tone}</span>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 text-xl font-semibold tabular-nums",
                        item.tone === "critical" ? "text-destructive" : "text-foreground",
                      )}
                    >
                      {item.count}
                    </span>
                  </Link>
                ))
              ) : (
                <div className="rounded-[14px] border border-border/60 bg-background/45 p-4 text-sm leading-6 text-muted-foreground">
                  No urgent admin issues are currently surfaced from the visible datasets.
                </div>
              )}
            </CardContent>
          </SurfaceCard>

          {/* KEY METRICS */}
          <SurfaceCard>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <div className="flex size-7 items-center justify-center rounded-[10px] border border-border/60 bg-background/60">
                  <BarChart3 className="size-3.5 text-muted-foreground" />
                </div>
                <CardTitle>Key Metrics</CardTitle>
              </div>
              <CardDescription>Platform-wide operational counts</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {(
                [
                  {
                    label: "Tournaments",
                    value: canReadTournaments ? (snapshot?.tournaments.length ?? 0) : "Hidden",
                    icon: Trophy,
                  },
                  {
                    label: "Teams",
                    value: canReadTeams ? (snapshot?.teams.length ?? 0) : "Hidden",
                    icon: Users,
                  },
                  {
                    label: "Players",
                    value: canReadTeams ? derived.players : "Hidden",
                    icon: UserCircle,
                  },
                  {
                    label: "Encounters",
                    value: canReadMatches ? (snapshot?.encounters.length ?? 0) : "Hidden",
                    icon: Swords,
                  },
                ] as { label: string; value: string | number; icon: LucideIcon }[]
              ).map(({ label, value, icon: Icon }) => (
                <div
                  key={label}
                  className="flex items-center justify-between rounded-[14px] border border-border/60 bg-background/45 px-4 py-2.5"
                >
                  <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
                    <Icon className="size-4 shrink-0" />
                    {label}
                  </div>
                  <span className="text-lg font-semibold tabular-nums text-foreground">{value}</span>
                </div>
              ))}
            </CardContent>
          </SurfaceCard>

          {/* CONTENT INVENTORY */}
          {hasContentInventory && (
            <SurfaceCard>
              <CardHeader className="pb-3">
                <CardTitle>Content</CardTitle>
                <CardDescription>Competitive content loaded for admin workflows</CardDescription>
              </CardHeader>
              <CardContent>
                <div
                  className={cn(
                    "grid gap-2",
                    [canReadHeroes, canReadMaps, canReadGamemodes].filter(Boolean).length === 3
                      ? "grid-cols-3"
                      : [canReadHeroes, canReadMaps, canReadGamemodes].filter(Boolean).length === 2
                        ? "grid-cols-2"
                        : "grid-cols-1",
                  )}
                >
                  {canReadHeroes && (
                    <div className="rounded-[14px] border border-border/60 bg-background/45 p-3 text-center">
                      <div className="text-2xl font-semibold tabular-nums text-foreground">
                        {snapshot?.heroes ?? 0}
                      </div>
                      <div className="mt-1 flex items-center justify-center gap-1 text-xs text-muted-foreground">
                        <Shield className="size-3" />
                        Heroes
                      </div>
                    </div>
                  )}
                  {canReadMaps && (
                    <div className="rounded-[14px] border border-border/60 bg-background/45 p-3 text-center">
                      <div className="text-2xl font-semibold tabular-nums text-foreground">
                        {snapshot?.maps ?? 0}
                      </div>
                      <div className="mt-1 flex items-center justify-center gap-1 text-xs text-muted-foreground">
                        <Map className="size-3" />
                        Maps
                      </div>
                    </div>
                  )}
                  {canReadGamemodes && (
                    <div className="rounded-[14px] border border-border/60 bg-background/45 p-3 text-center">
                      <div className="text-2xl font-semibold tabular-nums text-foreground">
                        {snapshot?.gamemodes ?? 0}
                      </div>
                      <div className="mt-1 flex items-center justify-center gap-1 text-xs text-muted-foreground">
                        <Gamepad2 className="size-3" />
                        Modes
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </SurfaceCard>
          )}
        </div>
      </section>

      {/* ── OPERATIONAL LANES ────────────────────────────── */}
      {operationalLanes.length > 0 && (
        <SurfaceCard>
          <CardHeader className="pb-3">
            <CardTitle>Operational Lanes</CardTitle>
            <CardDescription>
              Fast entry points into the admin surfaces this role can actively use.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {operationalLanes.map((lane) => {
                const Icon = lane.icon;
                return (
                  <Link
                    key={lane.title}
                    href={lane.href}
                    className="flex flex-col gap-3 rounded-[20px] border border-border/60 bg-background/45 p-4 transition-colors hover:bg-accent/30"
                  >
                    <div className="flex size-9 items-center justify-center rounded-[14px] border border-border/60 bg-background/60 text-muted-foreground">
                      <Icon className="size-4" />
                    </div>
                    <div>
                      <div className="text-sm font-medium text-foreground">{lane.title}</div>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {lane.description}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </CardContent>
        </SurfaceCard>
      )}
    </div>
  );
}
