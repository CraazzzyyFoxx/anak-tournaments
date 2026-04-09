"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ColumnDef } from "@tanstack/react-table";
import { Pencil, Trash2, RefreshCw, Trophy } from "lucide-react";
import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { EntityFormDialog } from "@/components/admin/EntityFormDialog";
import { DeleteConfirmDialog } from "@/components/admin/DeleteConfirmDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import tournamentService from "@/services/tournament.service";
import adminService from "@/services/admin.service";
import { Standings } from "@/types/tournament.types";
import { StandingUpdateInput } from "@/types/admin.types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
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

const emptyStandingForm: StandingUpdateInput = {
  position: 0,
  points: 0,
  win: 0,
  draw: 0,
  lose: 0,
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
  };
}

export default function StandingsPage() {
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const queryClient = useQueryClient();
  const canUpdate = hasPermission("standing.update");
  const canDelete = hasPermission("standing.delete");
  const canRecalculate = hasPermission("standing.recalculate");

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [recalculateDialogOpen, setRecalculateDialogOpen] = useState(false);
  const [selectedStanding, setSelectedStanding] = useState<Standings | null>(null);
  const [selectedTournamentId, setSelectedTournamentId] = useState<number | null>(null);
  const [selectedGroupFilter, setSelectedGroupFilter] = useState<string>("all");

  // Fetch tournaments
  const { data: tournamentsData } = useQuery({
    queryKey: ["tournaments"],
    queryFn: () => tournamentService.getAll(null)
  });

  // Fetch standings to extract groups for tabs
  const { data: allStandings } = useQuery({
    queryKey: ["standings", selectedTournamentId],
    queryFn: () => tournamentService.getStandings(selectedTournamentId!),
    enabled: !!selectedTournamentId
  });

  // Extract unique groups from standings
  const groupTabs = (() => {
    if (!allStandings || allStandings.length === 0) return [];
    const groupMap = new Map<number, { id: number; name: string; is_groups: boolean }>();
    for (const standing of allStandings) {
      if (standing.group && !groupMap.has(standing.group_id)) {
        groupMap.set(standing.group_id, {
          id: standing.group_id,
          name: standing.group.name,
          is_groups: standing.group.is_groups
        });
      }
    }
    const groups = Array.from(groupMap.values());
    const playoffGroups = groups.filter((g) => !g.is_groups).sort((a, b) => a.name.localeCompare(b.name));
    const stageGroups = groups.filter((g) => g.is_groups).sort((a, b) => a.name.localeCompare(b.name));
    return [...playoffGroups, ...stageGroups];
  })();

  // Form state
  const [formData, setFormData] = useState<StandingUpdateInput>({
    ...emptyStandingForm
  });

  // Mutations
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: StandingUpdateInput }) =>
      adminService.updateStanding(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["standings"] });
      setEditDialogOpen(false);
      setSelectedStanding(null);
      toast({ title: "Standing updated successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => adminService.deleteStanding(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["standings"] });
      setDeleteDialogOpen(false);
      setSelectedStanding(null);
      toast({ title: "Standing deleted successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });

  const recalculateMutation = useMutation({
    mutationFn: (tournamentId: number) => adminService.calculateStandings(tournamentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["standings"] });
      setRecalculateDialogOpen(false);
      toast({ title: "Standings recalculated successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
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

  const isEditDirty = editDialogOpen && hasUnsavedChanges(formData, getStandingForm(selectedStanding));

  const columns: ColumnDef<Standings>[] = [
    {
      accessorKey: "position",
      header: "Pos",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          {row.getValue<number>("position") === 1 && <Trophy className="h-4 w-4 text-yellow-500" />}
          <span className="font-bold">{row.getValue("position")}</span>
        </div>
      )
    },
    {
      accessorKey: "team",
      header: "Team",
      enableSorting: false,
      cell: ({ row }) => {
        const team = row.getValue<any>("team");
        return team ? <div className="font-medium">{team.name}</div> : "—";
      }
    },
    {
      accessorKey: "group",
      header: "Group",
      enableSorting: false,
      cell: ({ row }) => {
        const group = row.getValue<any>("group");
        return group ? <div className="text-sm">{group.name}</div> : "—";
      }
    },
    {
      accessorKey: "matches",
      header: "MP",
      cell: ({ row }) => <div className="text-center">{row.getValue("matches")}</div>
    },
    {
      accessorKey: "win",
      header: "W",
      cell: ({ row }) => <div className="text-center text-green-500">{row.getValue("win")}</div>
    },
    {
      accessorKey: "draw",
      header: "D",
      cell: ({ row }) => <div className="text-center text-yellow-500">{row.getValue("draw")}</div>
    },
    {
      accessorKey: "lose",
      header: "L",
      cell: ({ row }) => <div className="text-center text-red-500">{row.getValue("lose")}</div>
    },
    {
      accessorKey: "points",
      header: "Pts",
      cell: ({ row }) => (
        <div className="font-bold text-center">{row.getValue<number>("points").toFixed(1)}</div>
      )
    },
    {
      accessorKey: "buchholz",
      header: "BH",
      cell: ({ row }) => {
        const bh = row.getValue<number | null>("buchholz");
        return bh !== null ? (
          <div className="text-center text-sm">{bh.toFixed(2)}</div>
        ) : (
          <div className="text-center">—</div>
        );
      }
    },
    {
      id: "actions",
      cell: ({ row }) =>
        canUpdate || canDelete ? (
          <div className="flex items-center gap-2">
            {canUpdate ? (
              <Button aria-label={`Edit standing for ${row.original.team?.name ?? "team"}`} variant="ghost" size="icon" onClick={() => handleEdit(row.original)}>
                <Pencil className="h-4 w-4" />
              </Button>
            ) : null}
            {canDelete ? (
              <Button
                aria-label={`Delete standing for ${row.original.team?.name ?? "team"}`}
                variant="ghost"
                size="icon"
                onClick={() => handleDelete(row.original)}
                className="text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        ) : null
    }
  ];

  const selectedTournament = tournamentsData?.results.find((tournament) => tournament.id === selectedTournamentId);

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title="Standings"
        description="Manage tournament standings and rankings"
        actions={
          canRecalculate ? (
            <Button onClick={handleRecalculate} disabled={!selectedTournamentId}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Recalculate Standings
            </Button>
          ) : null
        }
      />

      <div className="flex items-center gap-4">
        <Label htmlFor="tournament-filter">Filter by Tournament:</Label>
        <Select
          value={selectedTournamentId?.toString() || "all"}
          onValueChange={(value) => {
            setSelectedTournamentId(value === "all" ? null : parseInt(value));
            setSelectedGroupFilter("all");
          }}
        >
          <SelectTrigger className="w-[300px]">
            <SelectValue placeholder="All Tournaments" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Tournaments</SelectItem>
            {tournamentsData?.results.map((tournament) => (
              <SelectItem key={tournament.id} value={tournament.id.toString()}>
                {tournament.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selectedTournamentId ? (
        <div className="rounded-md border p-4 bg-muted/50">
          <p className="text-sm text-muted-foreground">
            Showing standings for{" "}
            <span className="font-semibold">
              {selectedTournament?.name ?? "—"}
            </span>
          </p>
        </div>
      ) : null}

      {selectedTournamentId && groupTabs.length > 0 ? (
        <Tabs value={selectedGroupFilter} onValueChange={setSelectedGroupFilter}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            {groupTabs.map((group) => (
              <TabsTrigger key={group.id} value={group.id.toString()}>
                {group.name}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      ) : null}

      <AdminDataTable
        queryKey={(page, search, pageSize, sortField, sortDir) => ["standings-table", selectedTournamentId, selectedGroupFilter, allStandings?.length ?? 0, page, search, pageSize, sortField, sortDir]}
        queryFn={async (page, search, pageSize, sortField, sortDir) => {
          if (!selectedTournamentId || !allStandings) {
            return { results: [], total: 0, page: 1, per_page: pageSize };
          }

          let data = allStandings;

          if (selectedGroupFilter !== "all") {
            const groupId = parseInt(selectedGroupFilter);
            data = data.filter((standing) => standing.group_id === groupId);
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
        searchPlaceholder="Search by team name..."
        emptyMessage={
          selectedTournamentId
            ? "No standings found. Click 'Recalculate Standings' to generate them."
            : "Select a tournament to view standings."
        }

        onRowDoubleClick={canUpdate ? (row) => handleEdit(row.original) : undefined}
      />

      {/* Edit Dialog */}
      <EntityFormDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        title="Edit Standing"
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
            <Input
              id="position"
              type="number"
              value={formData.position}
              onChange={(e) => setFormData({ ...formData, position: parseInt(e.target.value) })}
              min="1"
            />
          </div>

          <div>
            <Label htmlFor="points">Points</Label>
            <Input
              id="points"
              type="number"
              step="0.5"
              value={formData.points}
              onChange={(e) => setFormData({ ...formData, points: parseFloat(e.target.value) })}
              min="0"
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label htmlFor="win">Wins</Label>
              <Input
                id="win"
                type="number"
                value={formData.win}
                onChange={(e) => setFormData({ ...formData, win: parseInt(e.target.value) })}
                min="0"
              />
            </div>

            <div>
              <Label htmlFor="draw">Draws</Label>
              <Input
                id="draw"
                type="number"
                value={formData.draw}
                onChange={(e) => setFormData({ ...formData, draw: parseInt(e.target.value) })}
                min="0"
              />
            </div>

            <div>
              <Label htmlFor="lose">Losses</Label>
              <Input
                id="lose"
                type="number"
                value={formData.lose}
                onChange={(e) => setFormData({ ...formData, lose: parseInt(e.target.value) })}
                min="0"
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
        title="Delete Standing"
        description="Are you sure you want to delete this standing entry? This action cannot be undone."
        isDeleting={deleteMutation.isPending}
      />

      {/* Recalculate Confirmation Dialog */}
      <AlertDialog open={recalculateDialogOpen} onOpenChange={setRecalculateDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Recalculate Standings?</AlertDialogTitle>
            <AlertDialogDescription>
              This will recalculate all standings for the selected tournament based on encounter
              results. Any manual changes will be overwritten.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmRecalculate}>
              {recalculateMutation.isPending ? "Calculating..." : "Recalculate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
