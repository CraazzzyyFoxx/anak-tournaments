"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { usePermissions } from "@/hooks/usePermissions";
import adminService from "@/services/admin.service";
import { getTournamentWorkspaceQueryKeys } from "../components/tournamentWorkspace.queryKeys";
import {
  hasChallongeSource,
  tabFallback,
  useHubStagesQuery,
  useHubTournamentQuery
} from "../hubQueries";
import { buildChecklist } from "./checklist-model";
import { LifecycleChecklist } from "./LifecycleChecklist";
import { PhaseStepper } from "./PhaseStepper";

const TournamentSetupTab = dynamic(
  () =>
    import("../components/TournamentSetupTab").then((module) => ({
      default: module.TournamentSetupTab
    })),
  { loading: () => tabFallback }
);

export default function OverviewTabPage() {
  const params = useParams<{ id: string }>();
  const tournamentId = Number(params.id);
  const isValidTournamentId = Number.isFinite(tournamentId) && tournamentId > 0;
  const { canAccessPermission } = usePermissions();

  const tournamentQuery = useHubTournamentQuery(tournamentId);
  const stagesQuery = useHubStagesQuery(tournamentId);
  const discordChannelQuery = useQuery({
    queryKey: getTournamentWorkspaceQueryKeys(tournamentId).discordChannel,
    queryFn: () => adminService.getDiscordChannel(tournamentId),
    enabled: isValidTournamentId
  });
  // Living-checklist data (§3, D13). Freshness comes from window focus and the
  // shell's realtime invalidation — deliberately NO refetchInterval (CG-O4).
  const readinessQuery = useQuery({
    queryKey: getTournamentWorkspaceQueryKeys(tournamentId).readiness,
    queryFn: () => adminService.getTournamentReadiness(tournamentId),
    enabled: isValidTournamentId,
    refetchOnWindowFocus: true
  });

  const tournament = tournamentQuery.data;
  const stages = stagesQuery.data ?? [];

  if (tournamentQuery.isLoading || stagesQuery.isLoading) {
    return tabFallback;
  }
  if (!tournament) {
    return null;
  }

  const basePath = `/admin/tournaments/${tournamentId}`;
  const challongeSourced = hasChallongeSource(tournament, stages);
  const readiness = readinessQuery.data;
  const checklistItems = readiness
    ? buildChecklist(readiness, {
        basePath,
        schedule: tournament.phase_schedule.map((entry) => entry.status),
        hasChallongeSource: challongeSourced
      })
    : [];
  const draftSessionStatus = readiness?.draft_session_status;
  const draftRunning = draftSessionStatus === "live" || draftSessionStatus === "paused";

  return (
    <div className="flex flex-col gap-4">
      <PhaseStepper tournament={tournament} />
      {draftRunning ? (
        // "Draft live -> Teams" banner (UA-O9). Phase 1 home of the draft
        // board is the draft tab; the Phase 2 permanent redirect draft->teams
        // keeps this link landing on its final address.
        <Card className="border-amber-700/50 bg-amber-950/20">
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <p className="text-sm text-amber-200">
              Team draft is {draftSessionStatus} — manage it from the draft board.
            </p>
            <Button asChild size="sm" variant="outline">
              <Link href={`${basePath}/draft`}>Open draft</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}
      <LifecycleChecklist
        items={checklistItems}
        isLoading={readinessQuery.isLoading}
      />
      <TournamentSetupTab
        tournamentId={tournamentId}
        tournament={tournament}
        stages={stages}
        hasChallongeSource={challongeSourced}
        canUpdateTournament={canAccessPermission("tournament.update", tournament.workspace_id)}
        discordChannel={discordChannelQuery.data}
        discordChannelLoading={discordChannelQuery.isLoading}
      />
    </div>
  );
}
