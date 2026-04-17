"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePermissions } from "@/hooks/usePermissions";
import adminService from "@/services/admin.service";
import encounterService from "@/services/encounter.service";
import teamService from "@/services/team.service";
import tournamentService from "@/services/tournament.service";
import workspaceService from "@/services/workspace.service";
import type { DivisionGridVersion } from "@/types/workspace.types";
import { TournamentOverviewTab } from "./components/TournamentOverviewTab";
import { TournamentWorkspaceHeader } from "./components/TournamentWorkspaceHeader";

type TournamentWorkspaceTab = "overview" | "setup" | "teams" | "matches" | "logs";

const tabFallback = (
  <div className="space-y-4">
    <Skeleton className="h-32 w-full rounded-xl" />
    <Skeleton className="h-64 w-full rounded-xl" />
  </div>
);

const TournamentSetupTab = dynamic(
  () =>
    import("./components/TournamentSetupTab").then((module) => ({
      default: module.TournamentSetupTab,
    })),
  { loading: () => tabFallback }
);

const TournamentTeamsTab = dynamic(
  () =>
    import("./components/TournamentTeamsTab").then((module) => ({
      default: module.TournamentTeamsTab,
    })),
  { loading: () => tabFallback }
);

const TournamentMatchesTab = dynamic(
  () =>
    import("./components/TournamentMatchesTab").then((module) => ({
      default: module.TournamentMatchesTab,
    })),
  { loading: () => tabFallback }
);

const TournamentLogsTab = dynamic(
  () =>
    import("./components/TournamentLogsTab").then((module) => ({
      default: module.TournamentLogsTab,
    })),
  { loading: () => tabFallback }
);

export default function AdminTournamentWorkspacePage() {
  const params = useParams<{ id: string }>();
  const tournamentId = Number(params.id);
  const { hasPermission, isSuperuser } = usePermissions();
  const [activeTab, setActiveTab] = useState<TournamentWorkspaceTab>("overview");

  const canUpdateTournament = hasPermission("tournament.update");
  const canDeleteTournament = hasPermission("tournament.delete");
  const canReadAnalytics = hasPermission("analytics.read");
  const canCreateTeam = hasPermission("team.create");
  const canUpdateTeam = hasPermission("team.update");
  const canDeleteTeam = hasPermission("team.delete");
  const canImportTeams = hasPermission("team.import");
  const canCreateEncounter = hasPermission("match.create");
  const canUpdateEncounter = hasPermission("match.update");
  const canDeleteEncounter = hasPermission("match.delete");
  const canSyncEncounters = hasPermission("match.sync");
  const canUpdateStanding = hasPermission("standing.update");
  const canDeleteStanding = hasPermission("standing.delete");
  const canRecalculateStandings = hasPermission("standing.recalculate");

  const tournamentQuery = useQuery({
    queryKey: ["admin", "tournament", tournamentId],
    queryFn: () => adminService.getTournament(tournamentId),
    enabled: Number.isFinite(tournamentId) && tournamentId > 0,
  });

  const teamsQuery = useQuery({
    queryKey: ["admin", "tournament", tournamentId, "teams"],
    queryFn: () => teamService.getAll(tournamentId),
    enabled: Number.isFinite(tournamentId) && tournamentId > 0,
  });

  const divisionGridsQuery = useQuery({
    queryKey: ["admin", "tournament", tournamentId, "division-grids"],
    queryFn: async () => {
      const workspaceId = tournamentQuery.data?.workspace_id;
      if (!workspaceId) return [];
      return workspaceService.getDivisionGrids(workspaceId);
    },
    enabled: Boolean(tournamentQuery.data?.workspace_id),
  });

  const standingsQuery = useQuery({
    queryKey: ["admin", "tournament", tournamentId, "standings"],
    queryFn: () => tournamentService.getStandings(tournamentId),
    enabled: Number.isFinite(tournamentId) && tournamentId > 0,
  });

  const encountersQuery = useQuery({
    queryKey: ["admin", "tournament", tournamentId, "encounters"],
    queryFn: () => encounterService.getAll(1, "", tournamentId, -1),
    enabled: Number.isFinite(tournamentId) && tournamentId > 0,
  });

  const discordChannelQuery = useQuery({
    queryKey: ["admin", "tournament", tournamentId, "discord-channel"],
    queryFn: () => adminService.getDiscordChannel(tournamentId),
    enabled: Number.isFinite(tournamentId) && tournamentId > 0,
  });

  const tournament = tournamentQuery.data;
  const teams = teamsQuery.data?.results ?? [];
  const stages = tournament?.stages ?? [];
  const standings = standingsQuery.data ?? [];
  const encounters = encountersQuery.data?.results ?? [];
  const divisionGridVersions: DivisionGridVersion[] = (divisionGridsQuery.data ?? [])
    .flatMap((grid) => grid.versions)
    .slice()
    .sort((left, right) => right.version - left.version);
  const completedEncounterCount = encounters.filter(
    (encounter) => encounter.status?.toUpperCase() === "COMPLETED"
  ).length;
  const hasChallongeSource = Boolean(
    tournament?.challonge_slug || stages.some((stage) => Boolean(stage.challonge_slug))
  );

  if (
    tournamentQuery.isLoading ||
    teamsQuery.isLoading ||
    standingsQuery.isLoading ||
    encountersQuery.isLoading
  ) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-28 w-full rounded-xl" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
        </div>
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (!tournament) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Tournament not found</CardTitle>
          <CardDescription>The requested admin workspace could not be loaded.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <TournamentWorkspaceHeader
        tournament={tournament}
        tournamentId={tournamentId}
        teamsCount={teams.length}
        encountersCount={encounters.length}
        standingsCount={standings.length}
        canReadAnalytics={canReadAnalytics}
        canUpdateTournament={canUpdateTournament}
        canDeleteTournament={canDeleteTournament}
        canToggleFinished={canUpdateTournament && isSuperuser}
        divisionGridVersions={divisionGridVersions}
        divisionGridLoading={divisionGridsQuery.isLoading}
      />

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as TournamentWorkspaceTab)}
        className="space-y-4"
      >
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="setup">Setup</TabsTrigger>
          <TabsTrigger value="teams">Teams</TabsTrigger>
          <TabsTrigger value="matches">Play & Results</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <TournamentOverviewTab
            stagesCount={stages.length}
            teamsCount={teams.length}
            encountersCount={encounters.length}
            standingsCount={standings.length}
            completedEncounterCount={completedEncounterCount}
            hasChallongeSource={hasChallongeSource}
          />
        </TabsContent>

        <TabsContent value="setup" className="space-y-4">
          {activeTab === "setup" ? (
            <TournamentSetupTab
              tournamentId={tournamentId}
              tournament={tournament}
              stages={stages}
              hasChallongeSource={hasChallongeSource}
              canUpdateTournament={canUpdateTournament}
              discordChannel={discordChannelQuery.data}
              discordChannelLoading={discordChannelQuery.isLoading}
            />
          ) : null}
        </TabsContent>

        <TabsContent value="teams" className="space-y-4">
          {activeTab === "teams" ? (
            <TournamentTeamsTab
              tournamentId={tournamentId}
              teams={teams}
              stagesCount={stages.length}
              hasChallongeSource={hasChallongeSource}
              canCreateTeam={canCreateTeam}
              canUpdateTeam={canUpdateTeam}
              canDeleteTeam={canDeleteTeam}
              canImportTeams={canImportTeams}
            />
          ) : null}
        </TabsContent>

        <TabsContent value="matches" className="space-y-4">
          {activeTab === "matches" ? (
            <TournamentMatchesTab
              tournamentId={tournamentId}
              teams={teams}
              stages={stages}
              encounters={encounters}
              standings={standings}
              hasChallongeSource={hasChallongeSource}
              canCreateEncounter={canCreateEncounter}
              canUpdateEncounter={canUpdateEncounter}
              canDeleteEncounter={canDeleteEncounter}
              canSyncEncounters={canSyncEncounters}
              canUpdateStanding={canUpdateStanding}
              canDeleteStanding={canDeleteStanding}
              canRecalculateStandings={canRecalculateStandings}
            />
          ) : null}
        </TabsContent>

        <TabsContent value="logs" className="space-y-4">
          {activeTab === "logs" ? (
            <TournamentLogsTab tournamentId={tournamentId} enabled={activeTab === "logs"} />
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}
