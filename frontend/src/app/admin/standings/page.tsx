"use client";

import { useId, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ColumnDef } from "@tanstack/react-table";
import { RefreshCw, Trophy } from "lucide-react";
import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { EntityFormDialog } from "@/components/admin/EntityFormDialog";
import { DeleteConfirmDialog } from "@/components/admin/DeleteConfirmDialog";
import { createRowActionsColumn } from "@/components/admin/row-actions-column";
import {
  TOURNAMENT_QUERY_PARAM,
  parseTournamentQueryParam,
  nextTournamentFilterQuery,
  TournamentFilterSelect
} from "@/components/admin/tournament-filter";
import TeamName from "@/components/TeamName";
import { Button } from "@/components/ui/button";
import { notify } from "@/lib/notify";
import { useTournamentRealtime } from "@/hooks/useTournamentRealtime";
import tournamentService from "@/services/tournament.service";
import adminService from "@/services/admin.service";
import { Standings } from "@/types/tournament.types";
import { StandingUpdateInput } from "@/types/admin.types";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePermissions } from "@/hooks/usePermissions";
import { hasUnsavedChanges } from "@/lib/form-change";
import { paginateResults, sortArray } from "@/lib/paginate-results";
import { formatTiebreakOrder } from "@/lib/tiebreakers";
import { useWorkspaceStore } from "@/stores/workspace.store";

const emptyStandingForm: StandingUpdateInput = {
  position: 0,
  points: 0,
  win: 0,
  draw: 0,
  lose: 0,
  buchholz: 0,
  tb: 0
};

function getStandingForm(standing: Standings | null): StandingUpdateInput {
  if (!standing) {
    return { ...emptyStandingForm };
  }

  return {
    position: standing.position,
    points: standing.points,
    win: standing.win,
    draw: standing.draw,
    lose: standing.lose,
    buchholz: standing.buchholz ?? 0,
    tb: standing.tb ?? 0
  };
}

function getStandingScopeKey(standing: Standings): string {
  if (standing.stage_item_id != null) return `stage-item-${standing.stage_item_id}`;
  if (standing.stage_id != null) return `stage-${standing.stage_id}`;
  return `standing-${standing.id}`;
}

function getStandingScopeLabel(standing: Standings): string {
  return standing.stage_item?.name ?? standing.stage?.name ?? "Unassigned";
}

export default function StandingsPage() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { canAccessPermission } = usePermissions();
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const queryClient = useQueryClient();
  const canUpdate = canAccessPermission("standing.update", workspaceId);
  const canDelete = canAccessPermission("standing.delete", workspaceId);
  const canRecalculate = canAccessPermission("standing.update", workspaceId);

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [recalculateDialogOpen, setRecalculateDialogOpen] = useState(false);
  const [selectedStanding, setSelectedStanding] = useState<Standings | null>(null);
  const selectedTournamentId = parseTournamentQueryParam(searchParams.get(TOURNAMENT_QUERY_PARAM));
  const [selectedScopeFilter, setSelectedScopeFilter] = useState<string>("all");
  const recalculateHintId = useId();

  useTournamentRealtime({
    tournamentId: selectedTournamentId,
    workspaceId
  });

  // Fetch tournaments
  const { data: tournamentsData } = useQuery({
    queryKey: ["tournaments"],
    queryFn: () => tournamentService.getAll(null)
  });

  // Fetch standings to extract stage/item tabs
  const { data: allStandings } = useQuery({
    queryKey: ["standings", selectedTournamentId],
    queryFn: () =>
      tournamentService.getStandings(selectedTournamentId!, {
        includeMatchesHistory: false,
        includeTeamGroup: false
      }),
    enabled: !!selectedTournamentId
  });

  const scopeTabs = (() => {
    if (!allStandings || allStandings.length === 0) return [];
    const scopeMap = new Map<
      string,
      { id: string; name: string; stageOrder: number; itemOrder: number }
    >();
    for (const standing of allStandings) {
      const scopeId = getStandingScopeKey(standing);
      if (scopeMap.has(scopeId)) continue;
      scopeMap.set(scopeId, {
        id: scopeId,
        name: getStandingScopeLabel(standing),
        stageOrder: standing.stage?.order ?? Number.MAX_SAFE_INTEGER,
        itemOrder: standing.stage_item?.order ?? Number.MAX_SAFE_INTEGER
      });
    }
    return Array.from(scopeMap.values()).sort(
      (a, b) =>
        a.stageOrder - b.stageOrder || a.itemOrder - b.itemOrder || a.name.localeCompare(b.name)
    );
  })();

  // Effective tie-break priority order for the currently selected scope.
  const activeTiebreakOrder = (() => {
    if (!allStandings || allStandings.length === 0) return null;
    const scoped =
      selectedScopeFilter === "all"
        ? allStandings
        : allStandings.filter((standing) => getStandingScopeKey(standing) === selectedScopeFilter);
    return scoped[0]?.tiebreak_order ?? null;
  })();

  // Form state
  const [formData, setFormData] = useState<StandingUpdateInput>({
    ...emptyStandingForm
  });

  // Mutations
  const updateMutation = useMutation({
    meta: { suppressErrorToast: true },
    mutationFn: ({ id, data }: { id: number; data: StandingUpdateInput }) =>
      adminService.updateStanding(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["standings"] });
      setEditDialogOpen(false);
      setSelectedStanding(null);
      notify.success("Standing updated successfully");
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => adminService.deleteStanding(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["standings"] });
      setDeleteDialogOpen(false);
      setSelectedStanding(null);
      notify.success("Standing deleted successfully");
    }
  });

  const recalculateMutation = useMutation({
    mutationFn: (tournamentId: number) => adminService.recalculateStandings(tournamentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["standings"] });
      setRecalculateDialogOpen(false);
      notify.success("Standings recalculated successfully");
    }
  });

  const handleEdit = (standing: Standings) => {
    updateMutation.reset();
    setSelectedStanding(standing);
    setFormData(getStandingForm(standing));
    setEditDialogOpen(true);
  };

  const handleDelete = (standing: Standings) => {
    setSelectedStanding(standing);
    setDeleteDialogOpen(true);
  };

  const handleRecalculate = () => {
    setRecalculateDialogOpen(true);
  };

  const handleSubmitUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedStanding) {
      updateMutation.mutate({
        id: selectedStanding.id,
        data: formData
      });
    }
  };

  const handleConfirmDelete = () => {
    if (selectedStanding) {
      deleteMutation.mutate(selectedStanding.id);
    }
  };

  const handleConfirmRecalculate = () => {
    if (selectedTournamentId) {
      recalculateMutation.mutate(selectedTournamentId);
    }
  };

  const handleTournamentFilterChange = (value: string) => {
    const query = nextTournamentFilterQuery(searchParams.toString(), TOURNAMENT_QUERY_PARAM, value);
    setSelectedScopeFilter("all");
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const isEditDirty =
    editDialogOpen && hasUnsavedChanges(formData, getStandingForm(selectedStanding));

  const columns: ColumnDef<Standings>[] = [
    {
      accessorKey: "position",
      header: "Pos",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          {row.getValue<number>("position") === 1 && (
            <Trophy className="h-4 w-4 text-warning" aria-hidden />
          )}
          <span className="font-bold tabular-nums">{row.getValue("position")}</span>
        </div>
      )
    },
    {
      accessorKey: "team",
      header: "Team",
      enableSorting: false,
      cell: ({ row }) => {
        const team = row.getValue<Standings["team"]>("team");
        return team ? <TeamName team={team} size="xs" nameClassName="font-medium" /> : "—";
      }
    },
    {
      accessorKey: "stage",
      header: "Stage",
      enableSorting: false,
      cell: ({ row }) => <div className="text-sm">{getStandingScopeLabel(row.original)}</div>
    },
    {
      accessorKey: "matches",
      header: "MP",
      cell: ({ row }) => <div className="text-center tabular-nums">{row.getValue("matches")}</div>
    },
    {
      accessorKey: "win",
      header: "W",
      cell: ({ row }) => (
        <div className="text-center tabular-nums text-success">{row.getValue("win")}</div>
      )
    },
    {
      accessorKey: "draw",
      header: "D",
      cell: ({ row }) => (
        <div className="text-center tabular-nums text-warning">{row.getValue("draw")}</div>
      )
    },
    {
      accessorKey: "lose",
      header: "L",
      cell: ({ row }) => (
        <div className="text-center tabular-nums text-danger">{row.getValue("lose")}</div>
      )
    },
    {
      accessorKey: "points",
      header: "Pts",
      cell: ({ row }) => (
        <div className="font-bold text-center tabular-nums">
          {row.getValue<number>("points").toFixed(1)}
        </div>
      )
    },
    {
      accessorKey: "buchholz",
      header: "BH",
      cell: ({ row }) => {
        const bh = row.getValue<number | null | undefined>("buchholz");
        return bh != null ? (
          <div className="text-center text-sm tabular-nums">{bh.toFixed(2)}</div>
        ) : (
          <div className="text-center">—</div>
        );
      }
    },
    {
      accessorKey: "tb",
      header: "TB",
      cell: ({ row }) => {
        const tb = row.getValue<number | null | undefined>("tb");
        return tb != null ? (
          <div className="text-center text-sm tabular-nums">{tb}</div>
        ) : (
          <div className="text-center">—</div>
        );
      }
    },
    createRowActionsColumn<Standings>({
      canUpdate,
      canDelete,
      onEdit: handleEdit,
      onDelete: handleDelete,
      getEditLabel: (row) => `Edit standing for ${row.team?.name ?? "team"}`,
      getDeleteLabel: (row) => `Delete standing for ${row.team?.name ?? "team"}`
    })
  ];

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title="Standings"
        description="Manage tournament standings and rankings"
        actions={
          canRecalculate ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {!selectedTournamentId ? (
                <span id={recalculateHintId} className="text-sm text-muted-foreground">
                  Pick a tournament first — standings are recalculated per tournament.
                </span>
              ) : null}
              <Button
                onClick={handleRecalculate}
                disabled={!selectedTournamentId}
                aria-describedby={!selectedTournamentId ? recalculateHintId : undefined}
              >
                <RefreshCw className="mr-2 h-4 w-4" aria-hidden />
                Recalculate standings
              </Button>
            </div>
          ) : null
        }
      />

      {selectedTournamentId && scopeTabs.length > 0 ? (
        <Tabs value={selectedScopeFilter} onValueChange={setSelectedScopeFilter}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            {scopeTabs.map((scope) => (
              <TabsTrigger key={scope.id} value={scope.id}>
                {scope.name}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      ) : null}

      {selectedTournamentId && activeTiebreakOrder && activeTiebreakOrder.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          Tiebreakers:{" "}
          <span className="font-medium text-foreground">
            {formatTiebreakOrder(activeTiebreakOrder)}
          </span>
        </p>
      ) : null}

      <AdminDataTable
        queryKey={(page, search, pageSize, sortField, sortDir) => [
          "standings-table",
          selectedTournamentId,
          selectedScopeFilter,
          allStandings?.length ?? 0,
          page,
          search,
          pageSize,
          sortField,
          sortDir
        ]}
        queryFn={async (page, search, pageSize, sortField, sortDir) => {
          if (!selectedTournamentId || !allStandings) {
            return { results: [], total: 0, page: 1, per_page: pageSize };
          }

          let data = allStandings;

          if (selectedScopeFilter !== "all") {
            data = data.filter((standing) => getStandingScopeKey(standing) === selectedScopeFilter);
          }

          const normalizedSearch = search.trim().toLowerCase();
          const filtered = normalizedSearch
            ? data.filter((standing) =>
                standing.team?.name.toLowerCase().includes(normalizedSearch)
              )
            : data;
          const sorted = sortArray(filtered, sortField, sortDir);

          return paginateResults(sorted, page, pageSize);
        }}
        columns={columns}
        searchPlaceholder="Search by team name…"
        emptyMessage={
          selectedTournamentId
            ? "No standings yet. Use “Recalculate standings” to build them from encounter results."
            : "No standings yet. Pick a tournament to see its table."
        }
        actions={
          <TournamentFilterSelect
            tournaments={tournamentsData?.results ?? []}
            selectedTournamentId={selectedTournamentId}
            onValueChange={handleTournamentFilterChange}
          />
        }
        onRowDoubleClick={canUpdate ? (row) => handleEdit(row.original) : undefined}
      />

      {/* Edit Dialog */}
      <EntityFormDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        title="Edit standing"
        description="Update standing details"
        onSubmit={handleSubmitUpdate}
        isSubmitting={updateMutation.isPending}
        submittingLabel="Updating standing…"
        errorMessage={updateMutation.isError ? updateMutation.error.message : undefined}
        isDirty={isEditDirty}
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="position">Position</Label>
            <NumberInput
              id="position"
              integer
              value={formData.position}
              onValueChange={(next) => setFormData({ ...formData, position: next ?? 0 })}
              min={1}
            />
          </div>

          <div>
            <Label htmlFor="points">Points</Label>
            <NumberInput
              id="points"
              value={formData.points}
              onValueChange={(next) => setFormData({ ...formData, points: next ?? 0 })}
              min={0}
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label htmlFor="win">Wins</Label>
              <NumberInput
                id="win"
                integer
                value={formData.win}
                onValueChange={(next) => setFormData({ ...formData, win: next ?? 0 })}
                min={0}
              />
            </div>

            <div>
              <Label htmlFor="draw">Draws</Label>
              <NumberInput
                id="draw"
                integer
                value={formData.draw}
                onValueChange={(next) => setFormData({ ...formData, draw: next ?? 0 })}
                min={0}
              />
            </div>

            <div>
              <Label htmlFor="lose">Losses</Label>
              <NumberInput
                id="lose"
                integer
                value={formData.lose}
                onValueChange={(next) => setFormData({ ...formData, lose: next ?? 0 })}
                min={0}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="buchholz">Buchholz (median)</Label>
              <NumberInput
                id="buchholz"
                value={formData.buchholz ?? 0}
                onValueChange={(next) => setFormData({ ...formData, buchholz: next ?? 0 })}
              />
            </div>

            <div>
              <Label htmlFor="tb">Head-to-head (TB)</Label>
              <NumberInput
                id="tb"
                integer
                value={formData.tb ?? 0}
                onValueChange={(next) => setFormData({ ...formData, tb: next ?? 0 })}
                min={0}
              />
            </div>
          </div>
        </div>
      </EntityFormDialog>

      {/* Delete Dialog */}
      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={handleConfirmDelete}
        title="Delete standing"
        description="Deleting this standing removes the team's row from this table. Recalculating the tournament will rebuild it from encounter results."
        isDeleting={deleteMutation.isPending}
      />

      {/* Recalculate Confirmation Dialog */}
      <AlertDialog open={recalculateDialogOpen} onOpenChange={setRecalculateDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Recalculate standings?</AlertDialogTitle>
            <AlertDialogDescription>
              This will recalculate all standings for the selected tournament based on encounter
              results. Any manual changes will be overwritten.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmRecalculate}>
              {recalculateMutation.isPending ? "Calculating…" : "Recalculate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
