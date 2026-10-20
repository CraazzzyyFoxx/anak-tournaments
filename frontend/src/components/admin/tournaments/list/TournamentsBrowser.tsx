"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { DataTable } from "@/components/data-table";
import { ConfirmDialog } from "@/components/kit/ConfirmDialog";
import { FilterBar } from "@/components/kit/FilterBar";
import { useFilters, type FilterDef } from "@/components/kit/useFilters";
import { PageStateCard } from "@/components/ui/page-state-card";
import { GameScopeControl } from "@/components/workspace/GameScopeControl";
import { useGameDescriptors } from "@/hooks/useGameDescriptors";
import { useGameScope } from "@/hooks/useGameScope";
import { ALL_DISCIPLINES, showsGameMarks } from "@/lib/site/discipline-scope";
import { notify } from "@/lib/notify";
import tournamentService from "@/services/tournament.service";
import adminService from "@/services/admin.service";
import type { Tournament } from "@/types/tournament.types";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspaceStore } from "@/stores/workspace.store";
import { tournamentQueryKeys } from "@/lib/tournament/query-keys";

import { useTournamentColumns } from "./useTournamentColumns";

/** The lifecycle chip: which rows each option keeps. */
const LIFECYCLE = {
  live: (tournament: Tournament) => tournament.status === "live" || tournament.status === "playoffs",
  registration: (tournament: Tournament) =>
    tournament.status === "registration" || tournament.status === "check_in",
  unpublished: (tournament: Tournament) => tournament.is_hidden,
  finished: (tournament: Tournament) =>
    tournament.is_finished || tournament.status === "completed" || tournament.status === "archived"
} as const;
type Lifecycle = keyof typeof LIFECYCLE;
const LIFECYCLE_KEYS = Object.keys(LIFECYCLE) as Lifecycle[];

function isLifecycle(value: string): value is Lifecycle {
  return value in LIFECYCLE;
}

/**
 * Every tournament in the workspace (T2). A row opens the hub; there is no
 * Inspector because the hub is one click away and says everything a panel
 * would. A stage-less unpublished draft also offers "Resume in wizard" in its
 * menu, which hands the id to the wizard's own resume prompt.
 */
export function TournamentsBrowser() {
  const t = useTranslations("adminTournaments.list");
  const router = useRouter();
  const { canAccessPermission } = usePermissions();
  const queryClient = useQueryClient();
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const canCreate = canAccessPermission("tournament.create", currentWorkspaceId);
  const canDelete = canAccessPermission("tournament.delete", currentWorkspaceId);

  const [pendingDelete, setPendingDelete] = useState<Tournament | null>(null);

  // Every game of the workspace under "all games", one game's under a game (spec §6.9); the server filters.
  const gameScope = useGameScope({ axis: currentWorkspaceId ?? "all" });
  const discipline = gameScope.game;
  const gameKind = gameScope.resolution?.game.kind;
  const ready = gameKind === "all" || gameKind === "game";
  const descriptors = useGameDescriptors();
  const games =
    gameScope.resolution !== null && showsGameMarks(gameScope.resolution, gameScope.games ?? [])
      ? descriptors
      : undefined;

  const tournamentsQuery = useQuery({
    queryKey: tournamentQueryKeys.adminList(discipline ?? ALL_DISCIPLINES),
    queryFn: () => tournamentService.getAll(null, undefined, discipline),
    enabled: ready
  });
  const tournaments = useMemo(() => tournamentsQuery.data?.results ?? [], [tournamentsQuery.data]);

  const defs = useMemo<FilterDef[]>(
    () => [
      {
        key: "status",
        label: t("columns.status"),
        kind: "single",
        options: LIFECYCLE_KEYS.map((key) => ({
          value: key,
          label: t(`status.${key}`),
          count: tournaments.filter(LIFECYCLE[key]).length
        }))
      }
    ],
    [t, tournaments]
  );
  const filters = useFilters(defs);
  const lifecycle = String(filters.values.status ?? "");
  const rows = isLifecycle(lifecycle) ? tournaments.filter(LIFECYCLE[lifecycle]) : tournaments;

  const deleteMutation = useMutation({
    mutationFn: (id: number) => adminService.deleteTournament(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tournamentQueryKeys.list() });
      setPendingDelete(null);
      notify.success(t("deleted"));
    }
  });

  const columns = useTournamentColumns({
    canCreate,
    canDelete,
    onDelete: useCallback((tournament: Tournament) => setPendingDelete(tournament), []),
    games
  });

  if (gameKind === "invalid" || gameKind === "empty") {
    return <GameScopeControl scope={gameScope} variant="multi" />;
  }
  if (tournamentsQuery.isError || gameScope.isError) {
    return (
      <PageStateCard
        state="error"
        onAction={() => {
          if (gameScope.isError) gameScope.refetch();
          void tournamentsQuery.refetch();
        }}
      />
    );
  }

  return (
    <>
      <DataTable<Tournament>
        rows={rows}
        isLoading={!ready || tournamentsQuery.isLoading}
        columns={columns}
        getRowId={(tournament) => String(tournament.id)}
        searchPlaceholder={t("searchPlaceholder")}
        filterKey={filters.filterKey}
        toolbar={<FilterBar defs={defs} filters={filters} />}
        emptyMessage={t("empty")}
        onRowClick={(row) => router.push(`/admin/tournaments/${row.original.id}`)}
      />

      {canDelete ? (
        <ConfirmDialog
          open={pendingDelete !== null}
          onOpenChange={(open) => {
            if (!open) setPendingDelete(null);
          }}
          onConfirm={() => {
            if (pendingDelete) deleteMutation.mutate(pendingDelete.id);
          }}
          pending={deleteMutation.isPending}
          intent={{
            title: t("deleteTitle"),
            description: t("deleteDescription", { name: pendingDelete?.name ?? "" }),
            confirmLabel: t("delete"),
            tone: "danger",
            cascade: [
              t("cascade.stages"),
              t("cascade.teams"),
              t("cascade.players"),
              t("cascade.encounters"),
              t("cascade.standings")
            ]
          }}
        />
      ) : null}
    </>
  );
}
