"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { NextActionHero } from "@/components/kit/NextActionHero";
import adminService from "@/services/admin.service";
import { getTournamentWorkspaceQueryKeys } from "@/lib/tournament/workspace-query-keys";
import { tabError, tabFallback, useHubStagesQuery, useHubTournamentQuery } from "../hubQueries";
import { buildChecklist, hasChallongeSource } from "@/components/admin/tournament-checklist";
import { LifecycleChecklist } from "./LifecycleChecklist";
import { PhaseStepper } from "./PhaseStepper";

/** Overview (T3 body): the next action, where the tournament is, what it still needs. */
export default function OverviewTabPage() {
  const t = useTranslations("adminTournament.overview");
  const checklistT = useTranslations("adminTournaments.checklist");
  const params = useParams<{ id: string }>();
  const tournamentId = Number(params.id);
  const isValidTournamentId = Number.isFinite(tournamentId) && tournamentId > 0;

  const tournamentQuery = useHubTournamentQuery(tournamentId);
  const stagesQuery = useHubStagesQuery(tournamentId);
  // Living-checklist data (§3, D13). Freshness comes from window focus and the
  // shell's realtime invalidation — deliberately NO refetchInterval (CG-O4).
  const readinessQuery = useQuery({
    queryKey: getTournamentWorkspaceQueryKeys(tournamentId).readiness,
    queryFn: () => adminService.getTournamentReadiness(tournamentId),
    enabled: isValidTournamentId,
    refetchOnWindowFocus: true
  });

  const tournament = tournamentQuery.data;

  if (tournamentQuery.isLoading || stagesQuery.isLoading) {
    return tabFallback;
  }
  if (!tournament) {
    return tabError(tournamentQuery.refetch);
  }

  const readiness = readinessQuery.data;
  const checklistItems = readiness
    ? buildChecklist(readiness, {
        basePath: `/admin/tournaments/${tournamentId}`,
        schedule: tournament.phase_schedule.map((entry) => entry.status),
        hasChallongeSource: hasChallongeSource(tournament, stagesQuery.data ?? [])
      }, checklistT)
    : [];

  // F3 ·3: the one thing worth doing next. Same `buildChecklist` the list
  // below renders — ranked, not a second data source, so the hero and the
  // checklist can never disagree.
  const nextAction = checklistItems.find(
    (item) => (item.state === "warn" || item.state === "todo") && item.href
  );

  return (
    <div className="flex flex-col gap-4">
      {nextAction?.href ? (
        <NextActionHero
          eyebrow={t("nextAction")}
          title={
            nextAction.detail
              ? t("nextActionTitle", { label: nextAction.label, detail: nextAction.detail })
              : nextAction.label
          }
          href={nextAction.href}
          cta={t("open")}
        />
      ) : null}
      <PhaseStepper tournament={tournament} />
      {readinessQuery.isError ? (
        tabError(readinessQuery.refetch)
      ) : (
        <LifecycleChecklist items={checklistItems} isLoading={readinessQuery.isLoading} />
      )}
    </div>
  );
}
