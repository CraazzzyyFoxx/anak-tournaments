"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import { PickupCreateMixDialog } from "@/app/balancer/mix/PickupCreateMixDialog";
import { PickupLeaderboard } from "@/app/balancer/mix/PickupLeaderboard";
import { PickupMixList } from "@/app/balancer/mix/PickupMixList";
import {
  LEADERBOARD_MIN_GAMES,
  leaderboardRows,
  sinceFor,
  type StatsPeriodKey
} from "@/app/balancer/mix/pickup-stats";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { PageStateCard } from "@/components/ui/page-state-card";
import { DisciplineSelector, DisciplineUnavailable } from "@/components/workspace/DisciplineSelector";
import { useBrowsingDiscipline } from "@/hooks/useBrowsingDiscipline";
import { usePermissions } from "@/hooks/usePermissions";
import { notify } from "@/lib/notify";
import { customGameKeys, customGameService } from "@/services/custom-game.service";
import { useWorkspaceStore } from "@/stores/workspace.store";

/**
 * Every mix a workspace has run, newest first — the entry point for hosting
 * one. Opening or starting a mix both leave this page for
 * `/balancer/mix/[gameId]`, which reads and edits the one already picked.
 *
 * A directory: it shows every game by default and narrows to one when the host picks it (`?discipline=`). The list,
 * the scoreboard and the creation form all follow that one resolved choice; an invalid or empty one makes no request.
 */
export default function BalancerPickupListPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useTranslations("mixes");
  const workspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);
  const statsScope = useWorkspaceStore((state) => state.statsScope);
  const hostWorkspaceId = useWorkspaceStore((state) => state.hostLockedWorkspaceId);
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const workspacesLoading = useWorkspaceStore((state) => state.isLoading);
  const all = statsScope === "all" && hostWorkspaceId == null;
  const visibleWorkspaces = workspaces.filter((workspace) =>
    all || workspace.id === (hostWorkspaceId ?? workspaceId)
  );
  const browsing = useBrowsingDiscipline({ allowsAll: true });
  const resolved = browsing.resolved;
  // `null` = every game. Only a concrete choice narrows the directory; invalid/empty ones never reach a request.
  const discipline = resolved?.kind === "concrete" ? resolved.code : null;
  const browsable = resolved?.kind === "all" || resolved?.kind === "concrete";
  const { canAccessPermission } = usePermissions();
  const creationWorkspaces = visibleWorkspaces.filter(
    (workspace) =>
      canAccessPermission("custom_game.create", workspace.id) &&
      (discipline === null ? workspace.disciplines_enabled.length > 0 : workspace.disciplines_enabled.includes(discipline))
  );
  const canEdit = creationWorkspaces.length > 0;
  const [createOpen, setCreateOpen] = useState(false);
  const gamesQueries = useQueries({
    queries: visibleWorkspaces.map((workspace) => ({
      queryKey: customGameKeys.list(workspace.id, discipline),
      queryFn: ({ signal }: { signal: AbortSignal }) => customGameService.list(workspace.id, discipline, { signal }),
      enabled: browsable,
    })),
  });
  const games = gamesQueries.flatMap((query) => query.data ?? []).sort((a, b) => b.id - a.id);

  const [period, setPeriod] = useState<StatsPeriodKey>("all");
  // Pinned to the period, not recomputed per render: a `since` that drifted
  // with the clock would be a new query key every render.
  const since = useMemo(() => sinceFor(period, new Date()), [period]);
  // The scoreboard is a per-game read when one game is chosen and the workspace-wide tally under `all`.
  const statsQueries = useQueries({
    queries: visibleWorkspaces.map((workspace) => ({
      queryKey: customGameKeys.stats(workspace.id, since, discipline ?? undefined),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        customGameService.stats(workspace.id, since, discipline ?? undefined, { signal }),
      enabled: browsable,
      staleTime: 60_000,
    })),
  });

  const createGame = useMutation({
    mutationFn: (input: { workspaceId: number; discipline: string; name: string; cloneFromGameId: number | null }) => {
      if (!creationWorkspaces.some((workspace) => workspace.id === input.workspaceId)) {
        throw new Error(t("create.workspaceRequired"));
      }
      if (input.cloneFromGameId != null && !games.some((game) =>
        game.id === input.cloneFromGameId && game.workspace_id === input.workspaceId && game.discipline === input.discipline
      )) {
        throw new Error(t("create.sourceRequired"));
      }
      return customGameService.create(input.workspaceId, input.discipline, input.name, input.cloneFromGameId);
    },
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: customGameKeys.lists(created.workspace_id) });
      router.push(`/balancer/mix/${created.id}`);
    },
    onError: (error) => notify.apiError(error)
  });

  if (!all && workspaceId == null && hostWorkspaceId == null) {
    return (
      <div className="flex flex-1 items-center justify-center py-12">
        <PageStateCard
          state="empty"
          title={t("chooseWorkspace")}
          description={t("workspaceHint")}
          className="w-full max-w-md"
        />
      </div>
    );
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h1 className="font-display text-title font-semibold text-[color:var(--aqt-fg)]">
            {t("title")}
          </h1>
          <p className="text-body text-[color:var(--aqt-fg-muted)]">{t("description")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {browsing.disciplines && resolved && browsable ? (
            <DisciplineSelector
              disciplines={browsing.disciplines}
              value={resolved.kind === "all" ? "all" : resolved.code}
              allowsAll
              onSelect={browsing.select}
            />
          ) : null}
          {canEdit && browsable ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />
              {t("createAction")}
            </Button>
          ) : null}
        </div>
      </div>

      {browsing.disciplines && resolved && !browsable ? (
        <DisciplineUnavailable
          resolved={resolved}
          disciplines={browsing.disciplines}
          allowsAll
          onSelect={browsing.select}
        />
      ) : (
        <div className="grid w-full min-w-0 grid-cols-1 gap-6 xl:grid-cols-[1fr_380px] xl:items-start">
          <div className="min-w-0 w-full">
            <PickupMixList
              canEdit={canEdit}
              games={games}
              communities={all ? Object.fromEntries(visibleWorkspaces.map((workspace) => [workspace.id, workspace.name])) : undefined}
              disciplineNames={
                resolved?.kind === "all" && browsing.disciplines
                  ? Object.fromEntries(browsing.disciplines.map((item) => [item.code, item.name]))
                  : undefined
              }
              loading={workspacesLoading || resolved === null || gamesQueries.some((query) => query.isLoading)}
              error={browsing.isError || gamesQueries.some((query) => query.isError)}
              onRetry={() => {
                if (browsing.isError) browsing.refetch();
                for (const query of gamesQueries) void query.refetch();
              }}
              onCreateGame={() => setCreateOpen(true)}
            />
          </div>
          <div className="flex min-w-0 w-full flex-col gap-4">
            {visibleWorkspaces.map((workspace, index) => (
              <div key={workspace.id} className="min-w-0 space-y-2">
                {all ? <h2 className="text-ui font-semibold">{workspace.name}</h2> : null}
                <PickupLeaderboard
                  members={leaderboardRows(statsQueries[index]?.data?.members ?? [], LEADERBOARD_MIN_GAMES)}
                  loading={workspacesLoading || resolved === null || statsQueries[index]?.isLoading === true}
                  error={statsQueries[index]?.isError === true}
                  onRetry={() => void statsQueries[index]?.refetch()}
                  period={period}
                  onPeriodChange={setPeriod}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        {createOpen && browsing.disciplines ? (
          <PickupCreateMixDialog
            games={games}
            workspaces={creationWorkspaces}
            disciplines={browsing.disciplines}
            fixedDiscipline={discipline}
            scopedWorkspaceId={all ? null : (hostWorkspaceId ?? workspaceId)}
            creating={createGame.isPending}
            onCreate={async (name, cloneFromGameId, creationWorkspaceId, creationDiscipline) => {
              await createGame.mutateAsync({
                workspaceId: creationWorkspaceId,
                discipline: creationDiscipline,
                name,
                cloneFromGameId
              });
            }}
            onClose={() => setCreateOpen(false)}
          />
        ) : null}
      </Dialog>
    </div>
  );
}
