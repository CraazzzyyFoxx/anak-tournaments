"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Pencil, RefreshCw, Trash2, Trophy } from "lucide-react";

import { DataTable, createKebabColumn } from "@/components/data-table";
import { EntityFormDialog } from "@/components/kit/EntityFormDialog";
import { StandingsArrangeBoard } from "@/components/admin/StandingsArrangeBoard";
import { FilterBar } from "@/components/kit/FilterBar";
import { ConfirmDialog } from "@/components/kit/ConfirmDialog";
import { useFilters, type FilterDef } from "@/components/kit/useFilters";
import {
  TOURNAMENT_QUERY_PARAM,
  parseTournamentQueryParam
} from "@/components/admin/tournament-filter";
import TeamName from "@/components/TeamName";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { getTournamentWorkspaceQueryKeys, invalidateTournamentWorkspace } from "@/lib/tournament/workspace-query-keys";
import { usePermissions } from "@/hooks/usePermissions";
import { useQueryParams } from "@/hooks/useQueryParams";
import { hasUnsavedChanges } from "@/lib/form-change";
import { notify } from "@/lib/notify";
import { formatTiebreakOrder } from "@/lib/tournament/tiebreakers";
import adminService from "@/services/admin.service";
import tournamentService from "@/services/tournament.service";
import type { StandingUpdateInput } from "@/types/admin.types";
import type { Standings } from "@/types/tournament.types";
import { EmptyNote } from "@/components/kit/EmptyNote";
import { adminQueryKeys } from "@/lib/admin/query-keys";
import { tournamentQueryKeys } from "@/lib/tournament/query-keys";

const PAGE_SIZE = 25;

const EMPTY_FORM: StandingUpdateInput = {
  points: 0,
  win: 0,
  draw: 0,
  lose: 0,
  buchholz: 0,
  tb: 0
};

function standingFormOf(standing: Standings | null): StandingUpdateInput {
  if (!standing) return { ...EMPTY_FORM };
  return {
    points: standing.points,
    win: standing.win,
    draw: standing.draw,
    lose: standing.lose,
    buchholz: standing.buchholz ?? 0,
    tb: standing.tb ?? 0
  };
}

/** The stage or stage item a standings row was computed for. */
function standingScopeLabel(standing: Standings, unassignedLabel: string): string {
  return standing.stage_item?.name ?? standing.stage?.name ?? unassignedLabel;
}

/**
 * The standings table, for one tournament or for a tournament picked with a
 * chip.
 *
 * Standings are computed per tournament, so there is no workspace-wide table to
 * show: unscoped, this asks which tournament rather than inventing a merged
 * ranking that would mean nothing. The rows come back whole, which is why the
 * table runs in client mode — search, sort and paging are local and cost no
 * refetch.
 *
 * `stageId` scopes it to one stage — the Bracket tab's stage editor shows its
 * own table there, so the stage is a pinned fact rather than a filter.
 */
export function StandingsBrowser({
  tournamentId,
  workspaceId,
  stageId
}: Readonly<{
  /** `null` = the tournament comes from the `tournament` chip. */
  tournamentId: number | null;
  workspaceId: number | null;
  /** Set = only this stage's rows, and no Stage filter to widen it again. */
  stageId?: number;
}>) {
  const t = useTranslations("adminTournaments.standings");
  const queryClient = useQueryClient();
  const { canAccessPermission } = usePermissions();
  const { searchParams } = useQueryParams({ resetOnChange: [] });

  const canUpdate = canAccessPermission("standing.update", workspaceId);
  const canDelete = canAccessPermission("standing.delete", workspaceId);

  const [editing, setEditing] = useState<Standings | null>(null);
  const [form, setForm] = useState<StandingUpdateInput>({ ...EMPTY_FORM });
  const [pendingDelete, setPendingDelete] = useState<Standings | null>(null);
  const [recalculateOpen, setRecalculateOpen] = useState(false);
  const [view, setView] = useState<"table" | "arrange">("table");

  const chipTournamentId = parseTournamentQueryParam(
    searchParams?.get(TOURNAMENT_QUERY_PARAM) ?? null
  );
  const scopeTournamentId = tournamentId ?? chipTournamentId;

  const tournamentsQuery = useQuery({
    queryKey: tournamentQueryKeys.list(),
    queryFn: () => tournamentService.getAll(null),
    enabled: tournamentId == null
  });

  const tournamentQuery = useQuery({
    queryKey: adminQueryKeys.tournament(scopeTournamentId),
    queryFn: () => adminService.getTournament(scopeTournamentId!),
    enabled: scopeTournamentId != null
  });

  // The hub shell already holds this exact key, so mounting the tab costs no
  // request; realtime addresses it too (`tournament.standings`).
  const standingsQuery = useQuery({
    queryKey:
      scopeTournamentId != null
        ? getTournamentWorkspaceQueryKeys(scopeTournamentId).standings
        : ["admin", "tournament", null, "standings"],
    queryFn: () =>
      tournamentService.getStandings(scopeTournamentId!, {
        includeMatchesHistory: false,
        includeTeamGroup: false
      }),
    enabled: scopeTournamentId != null
  });

  const standings = standingsQuery.data ?? [];

  const stagesQuery = useQuery({
    queryKey: adminQueryKeys.stages(scopeTournamentId),
    queryFn: () => adminService.getStages(scopeTournamentId!),
    enabled: scopeTournamentId != null
  });
  const stageList = stagesQuery.data ?? [];
  const scopedStage = stageId != null ? stageList.find((stage) => stage.id === stageId) : undefined;
  // Scoped to one stage, only ITS groups are worth filtering by.
  const stageItems = (stageId != null ? (scopedStage ? [scopedStage] : []) : stageList).flatMap(
    (stage) => stage.items
  );

  const defs = useMemo<FilterDef[]>(() => {
    const list: FilterDef[] = [];
    if (tournamentId == null) {
      list.push({
        key: TOURNAMENT_QUERY_PARAM,
        label: t("filters.tournament"),
        kind: "single",
        options: (tournamentsQuery.data?.results ?? []).map((entry) => ({
          value: String(entry.id),
          label: entry.name
        }))
      });
    }
    // Scoped to one stage there is nothing to pick: the stage is a pinned chip.
    if (stageId == null && stageList.length > 0) {
      list.push({
        key: "stage",
        label: t("filters.stage"),
        kind: "single",
        options: stageList.map((stage) => ({ value: String(stage.id), label: stage.name }))
      });
    }
    if (stageItems.length > 0) {
      list.push({
        key: "group",
        label: t("filters.group"),
        kind: "single",
        options: stageItems.map((item) => ({ value: String(item.id), label: item.name }))
      });
    }
    return list;
  }, [t, tournamentId, stageId, tournamentsQuery.data, stageList, stageItems]);

  const filters = useFilters(defs);
  const stageFilter = String(filters.values.stage ?? "");
  const groupFilter = String(filters.values.group ?? "");

  const rows = useMemo(() => {
    let scoped = stageId != null ? standings.filter((row) => row.stage_id === stageId) : standings;
    if (stageFilter) {
      scoped = scoped.filter((standing) => String(standing.stage_id ?? "") === stageFilter);
    }
    if (groupFilter) {
      scoped = scoped.filter((standing) => String(standing.stage_item_id ?? "") === groupFilter);
    }
    return scoped;
  }, [standings, stageId, stageFilter, groupFilter]);

  // Whatever tie-break order the scoped rows were actually ranked by, so the
  // sentence under the table describes these rows and not the tournament's
  // default profile.
  const tiebreakOrder = rows[0]?.tiebreak_order ?? null;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: tournamentQueryKeys.standingsAll() });
    if (scopeTournamentId != null) {
      invalidateTournamentWorkspace(queryClient, scopeTournamentId, workspaceId);
    }
  };

  const updateMutation = useMutation({
    meta: { suppressErrorToast: true },
    mutationFn: (payload: { id: number; data: StandingUpdateInput }) =>
      adminService.updateStanding(payload.id, payload.data),
    onSuccess: () => {
      invalidate();
      setEditing(null);
      notify.success(t("updated"));
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (standingId: number) => adminService.deleteStanding(standingId),
    onSuccess: () => {
      invalidate();
      setPendingDelete(null);
      notify.success(t("deleted"));
    }
  });

  const recalculateMutation = useMutation({
    mutationFn: () => adminService.recalculateStandings(scopeTournamentId!),
    onSuccess: () => {
      invalidate();
      setRecalculateOpen(false);
      notify.success(t("recalculated"));
    }
  });

  const syncMutation = useMutation({
    mutationFn: () => adminService.syncEncountersFromChallonge(scopeTournamentId!),
    onSuccess: () => {
      invalidate();
      notify.success(t("synced"));
    }
  });

  const columns = useMemo<ColumnDef<Standings>[]>(
    () => [
      {
        accessorKey: "position",
        header: "#",
        size: 72,
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            {row.original.position === 1 ? (
              <Trophy aria-hidden className="size-4 text-warning" />
            ) : null}
            <span className="font-bold tabular-nums">{row.original.position}</span>
            {row.original.is_pinned ? (
              <span title={t("pinnedPlace")} className="text-muted-foreground">
                <Lock aria-hidden className="size-3.5" />
                <span className="sr-only">{t("pinnedPlace")}</span>
              </span>
            ) : null}
          </div>
        )
      },
      {
        accessorKey: "team",
        header: t("columns.team"),
        enableSorting: false,
        cell: ({ row }) =>
          row.original.team ? (
            <TeamName team={row.original.team} size="xs" nameClassName="font-medium" />
          ) : (
            "—"
          )
      },
      // Scoped to one stage, the stage itself is the pinned chip: the column only
      // earns its place when the stage has groups to tell apart.
      ...(stageId == null
        ? [
            {
              id: "scope",
              header: t("columns.stage"),
              enableSorting: false,
              cell: ({ row }) => (
                <span className="text-sm">{standingScopeLabel(row.original, t("unassigned"))}</span>
              )
            } satisfies ColumnDef<Standings>
          ]
        : (scopedStage?.items.length ?? 0) > 1
          ? [
              {
                id: "scope",
                header: t("columns.group"),
                enableSorting: false,
                cell: ({ row }) => (
                  <span className="text-sm">{row.original.stage_item?.name ?? "—"}</span>
                )
              } satisfies ColumnDef<Standings>
            ]
          : []),
      {
        accessorKey: "matches",
        header: t("columns.matches"),
        size: 72,
        cell: ({ row }) => <span className="tabular-nums">{row.original.matches}</span>
      },
      {
        accessorKey: "win",
        header: t("winsShort"),
        size: 64,
        cell: ({ row }) => <span className="tabular-nums text-success">{row.original.win}</span>
      },
      {
        accessorKey: "draw",
        header: t("drawsShort"),
        size: 64,
        cell: ({ row }) => <span className="tabular-nums text-warning">{row.original.draw}</span>
      },
      {
        accessorKey: "lose",
        header: t("lossesShort"),
        size: 64,
        cell: ({ row }) => <span className="tabular-nums text-danger">{row.original.lose}</span>
      },
      {
        accessorKey: "points",
        header: t("columns.points"),
        size: 80,
        cell: ({ row }) => (
          <span className="font-bold tabular-nums">{row.original.points.toFixed(1)}</span>
        )
      },
      {
        accessorKey: "buchholz",
        header: t("columns.buchholz"),
        size: 110,
        // Median and full are separate tiebreakers, and a lone number reads as
        // whichever one the organizer assumes. Show the pair, matching the
        // public table.
        cell: ({ row }) => (
          <span className="text-sm tabular-nums" title={t("buchholzTitle")}>
            {row.original.buchholz == null
              ? "—"
              : row.original.full_buchholz == null
                ? row.original.buchholz.toFixed(2)
                : `${row.original.buchholz.toFixed(2)} / ${row.original.full_buchholz.toFixed(2)}`}
          </span>
        )
      },
      {
        accessorKey: "tb",
        header: t("columns.tiebreak"),
        size: 72,
        cell: ({ row }) => (
          <span className="text-sm tabular-nums">{row.original.tb != null ? row.original.tb : "—"}</span>
        )
      },
      createKebabColumn<Standings>(
        (row) => [
          {
            label: t("edit"),
            icon: Pencil,
            hidden: !canUpdate,
            onSelect: () => {
              updateMutation.reset();
              setEditing(row);
              setForm(standingFormOf(row));
            }
          },
          {
            label: t("delete"),
            icon: Trash2,
            destructive: true,
            hidden: !canDelete,
            onSelect: () => setPendingDelete(row)
          }
        ],
        { rowLabel: (row) => t("rowLabel", { name: row.team?.name ?? t("team") }) }
      )
    ],
    [t, canUpdate, canDelete, updateMutation, stageId, scopedStage]
  );

  if (workspaceId == null) {
    return (
      <EmptyNote>
        {t("workspaceRequired")}
      </EmptyNote>
    );
  }

  const canRecalculate = canUpdate && scopeTournamentId != null;
  const arranging = view === "arrange" && scopeTournamentId != null;

  const toolbar = (
    <FilterBar
      defs={defs}
      filters={filters}
      pinned={[
        ...(tournamentId != null
          ? [
              {
                key: TOURNAMENT_QUERY_PARAM,
                label: t("pinnedTournament", { name: tournamentQuery.data?.name ?? `#${tournamentId}` })
              }
            ]
          : []),
        ...(stageId != null
          ? [{ key: "stage", label: t("pinnedStage", { name: scopedStage?.name ?? `#${stageId}` }) }]
          : [])
      ]}
      trailing={
        <>
          {scopeTournamentId != null ? (
            <ToggleGroup
              type="single"
              variant="pill"
              size="sm"
              value={view}
              onValueChange={(next) => setView(next as "table" | "arrange")}
              aria-label={t("view")}
            >
              <ToggleGroupItem value="table">{t("table")}</ToggleGroupItem>
              <ToggleGroupItem value="arrange">{t("arrange")}</ToggleGroupItem>
            </ToggleGroup>
          ) : null}
          {canRecalculate ? (
            <Button
              variant="outline"
              size="sm"
              disabled={recalculateMutation.isPending}
              onClick={() => setRecalculateOpen(true)}
            >
              <RefreshCw aria-hidden className="size-4" />
              {t("recalculate")}
            </Button>
          ) : null}
          {canAccessPermission("challonge.update", workspaceId) && scopeTournamentId != null ? (
            <Button
              variant="outline"
              size="sm"
              disabled={syncMutation.isPending}
              onClick={() => syncMutation.mutate()}
            >
              <RefreshCw aria-hidden className="size-4" />
              {t("sync")}
            </Button>
          ) : null}
        </>
      }
    />
  );

  return (
    <div className="space-y-3">
      {arranging ? (
        <>
          {toolbar}
          <StandingsArrangeBoard
            rows={rows}
            stages={stageList}
            canUpdate={canUpdate}
            onChanged={invalidate}
          />
        </>
      ) : (
        <DataTable<Standings>
          rows={rows}
          isLoading={standingsQuery.isLoading}
          columns={columns}
          initialPageSize={PAGE_SIZE}
          searchPlaceholder={t("searchPlaceholder")}
          filterKey={filters.filterKey}
          getRowId={(row) => String(row.id)}
          toolbar={toolbar}
          emptyMessage={
            scopeTournamentId == null
              ? t("pickTournament")
              : t("empty")
          }
          onRowDoubleClick={
            canUpdate
              ? (row) => {
                  updateMutation.reset();
                  setEditing(row.original);
                  setForm(standingFormOf(row.original));
                }
              : undefined
          }
          renderMobileCard={(row) => (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                <span className="tabular-nums">{row.original.position}. </span>
                {row.original.is_pinned ? (
                  <>
                    <Lock aria-hidden className="mr-1 inline size-3.5" />
                    <span className="sr-only">{t("pinnedPlaceComma")}</span>
                  </>
                ) : null}
                {row.original.team?.name ?? t("unknownTeam")}
              </p>
              <p className="text-xs tabular-nums text-muted-foreground">
                {t("recordSummary", {
                  wins: row.original.win,
                  draws: row.original.draw,
                  losses: row.original.lose,
                  points: row.original.points.toFixed(1)
                })}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {standingScopeLabel(row.original, t("unassigned"))}
              </p>
            </div>
          )}
        />
      )}

      {tiebreakOrder && tiebreakOrder.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          {t.rich("tiebreakSummary", {
            value: formatTiebreakOrder(tiebreakOrder),
            valueText: (chunks) => <span className="font-medium text-foreground">{chunks}</span>
          })}
          <span className="font-medium text-foreground">
            {formatTiebreakOrder(tiebreakOrder)}
          </span>
        </p>
      ) : null}

      <EntityFormDialog
        open={editing != null}
        onOpenChange={(next) => {
          if (!next) setEditing(null);
        }}
        title={t("edit")}
        description={t("editDescription")}
        isSubmitting={updateMutation.isPending}
        submittingLabel={t("updating")}
        errorMessage={
          updateMutation.isError
            ? t("updateError", { message: updateMutation.error.message })
            : undefined
        }
        isDirty={editing != null && hasUnsavedChanges(form, standingFormOf(editing))}
        onSubmit={(event) => {
          event.preventDefault();
          if (editing) updateMutation.mutate({ id: editing.id, data: form });
        }}
      >
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="standing-points">{t("points")}</Label>
            <NumberInput
              id="standing-points"
              min={0}
              value={form.points ?? 0}
              onValueChange={(next) => setForm({ ...form, points: next ?? 0 })}
            />
          </div>
          <div>
            <Label htmlFor="standing-win">{t("wins")}</Label>
            <NumberInput
              id="standing-win"
              integer
              min={0}
              value={form.win ?? 0}
              onValueChange={(next) => setForm({ ...form, win: next ?? 0 })}
            />
          </div>
          <div>
            <Label htmlFor="standing-draw">{t("draws")}</Label>
            <NumberInput
              id="standing-draw"
              integer
              min={0}
              value={form.draw ?? 0}
              onValueChange={(next) => setForm({ ...form, draw: next ?? 0 })}
            />
          </div>
          <div>
            <Label htmlFor="standing-lose">{t("losses")}</Label>
            <NumberInput
              id="standing-lose"
              integer
              min={0}
              value={form.lose ?? 0}
              onValueChange={(next) => setForm({ ...form, lose: next ?? 0 })}
            />
          </div>
          <div>
            <Label htmlFor="standing-buchholz">{t("buchholzMedian")}</Label>
            <NumberInput
              id="standing-buchholz"
              value={form.buchholz ?? 0}
              onValueChange={(next) => setForm({ ...form, buchholz: next ?? 0 })}
            />
          </div>
          <div>
            <Label htmlFor="standing-tb">{t("headToHead")}</Label>
            <NumberInput
              id="standing-tb"
              integer
              min={0}
              value={form.tb ?? 0}
              onValueChange={(next) => setForm({ ...form, tb: next ?? 0 })}
            />
          </div>
        </div>
      </EntityFormDialog>

      <ConfirmDialog
        open={pendingDelete != null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null);
        }}
        pending={deleteMutation.isPending}
        intent={{
          title: t("delete"),
          description: t("deleteDescription", { name: pendingDelete?.team?.name ?? t("thisTeam") }),
          confirmLabel: t("delete"),
          tone: "danger"
        }}
        onConfirm={() => {
          if (pendingDelete) deleteMutation.mutate(pendingDelete.id);
        }}
      />

      <ConfirmDialog
        open={recalculateOpen}
        onOpenChange={setRecalculateOpen}
        pending={recalculateMutation.isPending}
        intent={{
          title: t("recalculateTitle"),
          description:
            t("recalculateDescription"),
          confirmLabel: t("recalculate"),
          tone: "warning"
        }}
        onConfirm={() => recalculateMutation.mutate()}
      />
    </div>
  );
}
