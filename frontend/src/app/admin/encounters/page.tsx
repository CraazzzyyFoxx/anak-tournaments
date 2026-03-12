"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ColumnDef } from "@tanstack/react-table";
import { Plus, Pencil, Trash2, CheckCircle, Clock, AlertCircle } from "lucide-react";
import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { EntityFormDialog } from "@/components/admin/EntityFormDialog";
import { DeleteConfirmDialog } from "@/components/admin/DeleteConfirmDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import encounterService from "@/services/encounter.service";
import tournamentService from "@/services/tournament.service";
import teamService from "@/services/team.service";
import adminService from "@/services/admin.service";
import { Encounter } from "@/types/encounter.types";
import { EncounterCreateInput, EncounterUpdateInput } from "@/types/admin.types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { usePermissions } from "@/hooks/usePermissions";
import { hasUnsavedChanges } from "@/lib/form-change";

const emptyEncounterForm: EncounterCreateInput = {
  name: "",
  tournament_id: 0,
  tournament_group_id: 0,
  home_team_id: 0,
  away_team_id: 0,
  round: 1,
  home_score: 0,
  away_score: 0,
  status: "open",
};

function getCreateEncounterForm(tournamentId: number | null): EncounterCreateInput {
  return { ...emptyEncounterForm, tournament_id: tournamentId || 0 };
}

function getEditEncounterForm(encounter: Encounter): EncounterUpdateInput {
  return {
    name: encounter.name,
    home_score: encounter.score.home,
    away_score: encounter.score.away,
    status: "open",
    round: encounter.round,
  };
}

export default function EncountersPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const queryClient = useQueryClient();
  const canCreate = hasPermission("match.create");
  const canUpdate = hasPermission("match.update");
  const canDelete = hasPermission("match.delete");

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedEncounter, setSelectedEncounter] = useState<Encounter | null>(null);
  const [selectedTournamentId, setSelectedTournamentId] = useState<number | null>(null);

  // Fetch tournaments and teams
  const { data: tournamentsData } = useQuery({
    queryKey: ["tournaments"],
    queryFn: () => tournamentService.getAll(null)
  });

  const { data: teamsData } = useQuery({
    queryKey: ["teams", selectedTournamentId],
    queryFn: () =>
      selectedTournamentId ? teamService.getAll(selectedTournamentId) : Promise.resolve(null),
    enabled: !!selectedTournamentId
  });

  // Form state
  const [formData, setFormData] = useState<EncounterCreateInput | EncounterUpdateInput>({
    ...emptyEncounterForm,
  });

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data: EncounterCreateInput) => adminService.createEncounter(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["encounters"] });
      setCreateDialogOpen(false);
      resetForm();
      toast({ title: "Encounter created successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: EncounterUpdateInput }) =>
      adminService.updateEncounter(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["encounters"] });
      setEditDialogOpen(false);
      setSelectedEncounter(null);
      resetForm();
      toast({ title: "Encounter updated successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => adminService.deleteEncounter(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["encounters"] });
      setDeleteDialogOpen(false);
      setSelectedEncounter(null);
      toast({ title: "Encounter deleted successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });

  const resetForm = () => {
    setFormData(getCreateEncounterForm(selectedTournamentId));
  };

  const handleCreate = () => {
    createMutation.reset();
    setCreateDialogOpen(true);
    resetForm();
  };

  const handleEdit = (encounter: Encounter) => {
    updateMutation.reset();
    setSelectedEncounter(encounter);
    setFormData(getEditEncounterForm(encounter));
    setEditDialogOpen(true);
  };

  const handleDelete = (encounter: Encounter) => {
    setSelectedEncounter(encounter);
    setDeleteDialogOpen(true);
  };

  const handleSubmitCreate = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(formData as EncounterCreateInput);
  };

  const handleSubmitUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedEncounter) {
      updateMutation.mutate({
        id: selectedEncounter.id,
        data: formData as EncounterUpdateInput
      });
    }
  };

  const handleConfirmDelete = () => {
    if (selectedEncounter) {
      deleteMutation.mutate(selectedEncounter.id);
    }
  };

  const createFormInitial = getCreateEncounterForm(selectedTournamentId);
  const editFormInitial = selectedEncounter ? getEditEncounterForm(selectedEncounter) : createFormInitial;
  const isCreateDirty = createDialogOpen && hasUnsavedChanges(formData, createFormInitial);
  const isEditDirty = editDialogOpen && hasUnsavedChanges(formData, editFormInitial);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle className="h-3 w-3" />;
      case "pending":
        return <Clock className="h-3 w-3" />;
      default:
        return <AlertCircle className="h-3 w-3" />;
    }
  };

  const columns: ColumnDef<Encounter>[] = [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => <div className="font-medium">{row.getValue("name")}</div>
    },
    {
      accessorKey: "tournament_group",
      header: "Group",
      cell: ({ row }) => {
        const group = row.getValue<any>("tournament_group");
        return group ? <div className="text-sm">{group.name}</div> : "—";
      }
    },
    {
      accessorKey: "round",
      header: "Round",
      cell: ({ row }) => <div>Round {row.getValue("round")}</div>
    },
    {
      accessorKey: "score",
      header: "Score",
      cell: ({ row }) => {
        const score = row.getValue<any>("score");
        return (
          <div className="font-semibold tabular-nums">
            {score.home} – {score.away}
          </div>
        );
      }
    },
    {
      accessorKey: "closeness",
      header: "Closeness",
      cell: ({ row }) => {
        const closeness = row.getValue<number | null>("closeness");
        return closeness ? (
          <div className="text-sm text-muted-foreground">{(closeness * 100).toFixed(0)}%</div>
        ) : (
          "—"
        );
      }
    },
    {
      accessorKey: "has_logs",
      header: "Logs",
      cell: ({ row }) => {
        const hasLogs = row.getValue<boolean>("has_logs");
        return hasLogs ? (
          <Badge variant="default">Yes</Badge>
        ) : (
          <Badge variant="outline">No</Badge>
        );
      }
    },
    {
      id: "actions",
      cell: ({ row }) =>
        canUpdate || canDelete ? (
          <div className="flex items-center gap-2">
            {canUpdate ? (
              <Button aria-label={`Edit ${row.original.name}`} variant="ghost" size="icon" onClick={() => handleEdit(row.original)}>
                <Pencil className="h-4 w-4" />
              </Button>
            ) : null}
            {canDelete ? (
              <Button
                aria-label={`Delete ${row.original.name}`}
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

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title="Encounters"
        description="Manage tournament encounters and matches"
        actions={
          canCreate ? (
            <Button onClick={handleCreate} disabled={!selectedTournamentId}>
              <Plus className="mr-2 h-4 w-4" />
              Create Encounter
            </Button>
          ) : null
        }
      />

      <div className="flex items-center gap-4">
        <Label htmlFor="tournament-filter">Filter by Tournament:</Label>
        <Select
          value={selectedTournamentId?.toString() || ""}
          onValueChange={(value) => setSelectedTournamentId(value ? parseInt(value) : null)}
        >
          <SelectTrigger className="w-[300px]">
            <SelectValue placeholder="Select Tournament" />
          </SelectTrigger>
          <SelectContent>
            {tournamentsData?.results.map((tournament) => (
              <SelectItem key={tournament.id} value={tournament.id.toString()}>
                {tournament.is_league ? tournament.name : `Tournament ${tournament.number}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <AdminDataTable
        queryKey={(page, search, pageSize) => ["encounters", selectedTournamentId, page, search, pageSize]}
        queryFn={async (page, search, pageSize) => {
          if (!selectedTournamentId) {
            return { results: [], total: 0, page: 1, per_page: pageSize };
          }

          return encounterService.getAll(page, search, selectedTournamentId, pageSize);
        }}
        columns={columns}
        searchPlaceholder="Search encounters..."
        emptyMessage={
          selectedTournamentId
            ? "No encounters found in this tournament."
            : "Select a tournament to view encounters."
        }
        onRowClick={(row) => router.push(`/encounters/${row.original.id}`)}
      />

      {/* Create Dialog */}
      <EntityFormDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        title="Create Encounter"
        description="Create a new encounter between two teams"
        onSubmit={handleSubmitCreate}
        isSubmitting={createMutation.isPending}
        submittingLabel="Creating encounter…"
        errorMessage={createMutation.isError ? createMutation.error.message : undefined}
        isDirty={isCreateDirty}
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="name">Encounter Name *</Label>
            <Input
              id="name"
              value={(formData as EncounterCreateInput).name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              placeholder="e.g., Quarter Final 1"
            />
          </div>

          <div>
            <Label htmlFor="home_team_id">Home Team *</Label>
            <Select
              value={(formData as EncounterCreateInput).home_team_id?.toString()}
              onValueChange={(value) =>
                setFormData({ ...formData, home_team_id: parseInt(value) })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select home team" />
              </SelectTrigger>
              <SelectContent>
                {teamsData?.results.map((team) => (
                  <SelectItem key={team.id} value={team.id.toString()}>
                    {team.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="away_team_id">Away Team *</Label>
            <Select
              value={(formData as EncounterCreateInput).away_team_id?.toString()}
              onValueChange={(value) =>
                setFormData({ ...formData, away_team_id: parseInt(value) })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select away team" />
              </SelectTrigger>
              <SelectContent>
                {teamsData?.results.map((team) => (
                  <SelectItem key={team.id} value={team.id.toString()}>
                    {team.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="round">Round *</Label>
            <Input
              id="round"
              type="number"
              value={(formData as EncounterCreateInput).round}
              onChange={(e) => setFormData({ ...formData, round: parseInt(e.target.value) })}
              required
              min="1"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="home_score">Home Score</Label>
              <Input
                id="home_score"
                type="number"
                value={(formData as EncounterCreateInput).home_score}
                onChange={(e) =>
                  setFormData({ ...formData, home_score: parseInt(e.target.value) })
                }
                min="0"
              />
            </div>

            <div>
              <Label htmlFor="away_score">Away Score</Label>
              <Input
                id="away_score"
                type="number"
                value={(formData as EncounterCreateInput).away_score}
                onChange={(e) =>
                  setFormData({ ...formData, away_score: parseInt(e.target.value) })
                }
                min="0"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="status">Status</Label>
            <Select
              value={(formData as EncounterCreateInput).status}
              onValueChange={(value) => setFormData({ ...formData, status: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </EntityFormDialog>

      {/* Edit Dialog */}
      <EntityFormDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        title="Edit Encounter"
        description="Update encounter details"
        onSubmit={handleSubmitUpdate}
        isSubmitting={updateMutation.isPending}
        submittingLabel="Updating encounter…"
        errorMessage={updateMutation.isError ? updateMutation.error.message : undefined}
        isDirty={isEditDirty}
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="edit-name">Encounter Name</Label>
            <Input
              id="edit-name"
              value={(formData as EncounterUpdateInput).name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </div>

          <div>
            <Label htmlFor="edit-round">Round</Label>
            <Input
              id="edit-round"
              type="number"
              value={(formData as EncounterUpdateInput).round}
              onChange={(e) => setFormData({ ...formData, round: parseInt(e.target.value) })}
              min="1"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="edit-home_score">Home Score</Label>
              <Input
                id="edit-home_score"
                type="number"
                value={(formData as EncounterUpdateInput).home_score}
                onChange={(e) =>
                  setFormData({ ...formData, home_score: parseInt(e.target.value) })
                }
                min="0"
              />
            </div>

            <div>
              <Label htmlFor="edit-away_score">Away Score</Label>
              <Input
                id="edit-away_score"
                type="number"
                value={(formData as EncounterUpdateInput).away_score}
                onChange={(e) =>
                  setFormData({ ...formData, away_score: parseInt(e.target.value) })
                }
                min="0"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="edit-status">Status</Label>
            <Select
              value={(formData as EncounterUpdateInput).status}
              onValueChange={(value) => setFormData({ ...formData, status: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </EntityFormDialog>

      {/* Delete Dialog */}
      {canDelete ? (
        <DeleteConfirmDialog
          open={deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
          onConfirm={handleConfirmDelete}
          title="Delete Encounter"
          description={`Are you sure you want to delete "${selectedEncounter?.name}"? This action cannot be undone.`}
          cascadeInfo={["All matches in this encounter", "All match statistics and logs"]}
          isDeleting={deleteMutation.isPending}
        />
      ) : null}
    </div>
  );
}
