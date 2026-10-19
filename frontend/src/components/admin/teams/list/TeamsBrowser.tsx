"use client";

import { useId, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";

import { DataTable } from "@/components/data-table";
import { FilterBar } from "@/components/kit/FilterBar";
import { Inspector } from "@/components/kit/Inspector";
import { ConfirmDialog } from "@/components/kit/ConfirmDialog";
import { useFilters } from "@/components/kit/useFilters";
import { TeamCreateDialog } from "@/components/admin/teams/TeamCreateDialog";
import {
  TOURNAMENT_QUERY_PARAM,
  parseTournamentQueryParam
} from "@/components/admin/tournament-filter";
import { Button } from "@/components/ui/button";
import { usePermissions } from "@/hooks/usePermissions";
import { useQueryParams } from "@/hooks/useQueryParams";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import adminService from "@/services/admin.service";
import teamService from "@/services/team.service";
import tournamentService from "@/services/tournament.service";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type { Team } from "@/types/team.types";
import { adminQueryKeys } from "@/lib/admin/query-keys";
import { tournamentQueryKeys } from "@/lib/tournament/query-keys";

import { teamFilterDefs } from "./filters";
import { TeamInspectorPanel } from "./TeamInspectorPanel";
import { useTeamColumns } from "./useTeamColumns";

const PAGE_SIZE = 15;

/**
 * Every roster in the workspace (T2).
 *
 * The tournament scope is a filter-bar chip on the same `?tournament=` param
 * the sibling browsers use, so a pinned link still opens pinned. A row opens
 * the inspector at `?id=` — the roster summary — and "Open page" goes on to
 * the team editor, which is where a roster is actually changed.
 */
export function TeamsBrowser() {
  const t = useTranslations("adminPeople.teams");
  const { canAccessPermission } = usePermissions();
  const workspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);
  const queryClient = useQueryClient();
  // `id` is the inspector, not a filter: opening a row must not drop the page
  // the row sits on, so nothing resets here.
  const { searchParams, setParams } = useQueryParams({ resetOnChange: [], shallow: true });
  const openId = searchParams?.get("id") ?? null;

  const canCreateTeam = canAccessPermission("team.create", workspaceId);
  const canDeleteTeam = canAccessPermission("team.delete", workspaceId);

  const [pageRows, setPageRows] = useState<Team[]>([]);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Team | null>(null);
  const createHintId = useId();

  const tournamentsQuery = useQuery({
    queryKey: tournamentQueryKeys.list(),
    queryFn: () => tournamentService.getAll(null)
  });

  const defs = useMemo(
    () => teamFilterDefs(tournamentsQuery.data?.results ?? [], t("labels.tournament")),
    [t, tournamentsQuery.data]
  );

  const filters = useFilters(defs);
  const selectedTournamentId = parseTournamentQueryParam(
    String(filters.values[TOURNAMENT_QUERY_PARAM] ?? "") || null
  );

  const deleteMutation = useMutation({
    mutationFn: (id: number) => adminService.deleteTeam(id),
    onSuccess: () => {
      const removed = pendingDelete;
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: tournamentQueryKeys.teamsAll() }),
        queryClient.invalidateQueries({ queryKey: tournamentQueryKeys.list() }),
        removed?.tournament_id != null
          ? queryClient.invalidateQueries({
              queryKey: adminQueryKeys.tournamentTeams(removed.tournament_id)
            })
          : Promise.resolve()
      ]);
      setPendingDelete(null);
      if (removed && String(removed.id) === openId) setParams({ id: null });
      notify.success(t("deleted"));
    }
  });

  const createBlockedReason =
    canCreateTeam && selectedTournamentId == null
      ? t("pickTournament")
      : null;

  const columns = useTeamColumns({ canDelete: canDeleteTeam, onDelete: setPendingDelete });

  const openRow = pageRows.find((row) => String(row.id) === openId) ?? null;
  const openIndex = openRow ? pageRows.indexOf(openRow) : -1;

  return (
    <>
      <div
        className={cn("grid items-start gap-4", openRow && "lg:grid-cols-[minmax(0,1fr)_380px]")}
      >
        <div className="min-w-0">
          <DataTable<Team>
            columns={columns}
            initialPageSize={PAGE_SIZE}
            searchPlaceholder={t("search")}
            filterKey={filters.filterKey}
            inspectorId={openId}
            getRowId={(row) => String(row.id)}
            toolbar={
              <FilterBar
                defs={defs}
                filters={filters}
                trailing={
                  canCreateTeam ? (
                    <>
                      {createBlockedReason ? (
                        <span id={createHintId} className="text-sm text-muted-foreground">
                          {createBlockedReason}
                        </span>
                      ) : null}
                      <Button
                        size="sm"
                        onClick={() => setCreateDialogOpen(true)}
                        disabled={createBlockedReason != null}
                        aria-describedby={createBlockedReason ? createHintId : undefined}
                      >
                        <Plus className="size-4" aria-hidden />
                        {t("create")}
                      </Button>
                    </>
                  ) : null
                }
              />
            }
            emptyMessage={
              selectedTournamentId
                ? t("emptyFiltered")
                : t("empty")
            }
            onRowClick={(row) => setParams({ id: String(row.original.id) })}
            renderMobileCard={(row) => (
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{row.original.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {row.original.tournament?.name ?? t("noTournamentShort")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t.rich("mobileSummary", {
                    count: row.original.players?.length ?? 0,
                    avgSr: row.original.avg_sr.toFixed(0),
                    num: (chunks) => <span className="font-mono tabular-nums">{chunks}</span>
                  })}
                </p>
              </div>
            )}
            queryKey={(page, search, pageSize, sortField, sortDir) => [
              "teams",
              selectedTournamentId,
              page,
              search,
              pageSize,
              sortField,
              sortDir
            ]}
            queryFn={(page, search, pageSize, sortField, sortDir) =>
              teamService.getAll({
                tournamentId: selectedTournamentId,
                page,
                perPage: pageSize,
                search: search || undefined,
                sort: sortField ?? "avg_sr",
                order: sortField ? sortDir : "asc"
              })
            }
            onPageRowsChange={setPageRows}
          />
        </div>

        <Inspector
          openId={openRow ? openId : null}
          onClose={() => setParams({ id: null })}
          title={openRow?.name ?? ""}
          subtitle={openRow?.tournament?.name ?? undefined}
          openHref={openRow ? `/admin/teams/${openRow.id}` : undefined}
          onPrev={
            openIndex > 0 ? () => setParams({ id: String(pageRows[openIndex - 1].id) }) : undefined
          }
          onNext={
            openIndex >= 0 && openIndex < pageRows.length - 1
              ? () => setParams({ id: String(pageRows[openIndex + 1].id) })
              : undefined
          }
        >
          {openRow ? <TeamInspectorPanel team={openRow} /> : null}
        </Inspector>
      </div>

      {selectedTournamentId != null ? (
        <TeamCreateDialog
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          tournamentId={selectedTournamentId}
        />
      ) : null}

      <ConfirmDialog
        open={pendingDelete != null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null);
        }}
        pending={deleteMutation.isPending}
        intent={{
          title: t("delete"),
          description: t("deleteDescription", { name: pendingDelete?.name ?? t("teamName") }),
          confirmLabel: t("delete"),
          tone: "danger",
          cascade: [t("cascadePlayers"), t("cascadeStats")]
        }}
        onConfirm={() => {
          if (pendingDelete) deleteMutation.mutate(pendingDelete.id);
        }}
      />
    </>
  );
}
