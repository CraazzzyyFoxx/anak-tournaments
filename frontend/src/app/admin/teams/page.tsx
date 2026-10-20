"use client";

import { useTranslations } from "next-intl";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { TeamsBrowser } from "@/components/admin/teams/list/TeamsBrowser";
import { TOURNAMENT_QUERY_PARAM } from "@/components/admin/tournament-filter";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { GameScopeGate } from "@/components/workspace/GameScopeGate";
import { useGameBoundParams } from "@/components/workspace/scope-pill-store";
import { useGameScope } from "@/hooks/useGameScope";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspaceStore } from "@/stores/workspace.store";

/** The teams list's one-game filter (R5): a scope pick drops it from the URL. */
const GAME_BOUND_PARAMS = [TOURNAMENT_QUERY_PARAM] as const;

/** Every roster of the workspace: a multi page (spec §6.9) — every game's teams, or the game in scope. */
export default function TeamsPage() {
  const t = useTranslations("adminPeople.teams");
  const { canAccessPermission, isLoaded } = usePermissions();
  const workspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);
  const scope = useGameScope({ axis: workspaceId ?? "all" });
  useGameBoundParams(GAME_BOUND_PARAMS);

  if (!isLoaded) return <Skeleton className="h-64 w-full rounded-xl" />;

  if (!canAccessPermission("team.read", workspaceId)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("unauthorized")}</CardTitle>
          <CardDescription>
            {t("noPermission")}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <AdminPageHeader title={t("title")} />
      <GameScopeGate scope={scope}>{(game) => <TeamsBrowser discipline={game} />}</GameScopeGate>
    </div>
  );
}
