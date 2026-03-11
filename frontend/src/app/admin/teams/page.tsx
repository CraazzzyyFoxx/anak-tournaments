"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ColumnDef } from "@tanstack/react-table";
import { Plus, Pencil, Trash2, Users } from "lucide-react";
import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { EntityFormDialog } from "@/components/admin/EntityFormDialog";
import { DeleteConfirmDialog } from "@/components/admin/DeleteConfirmDialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import teamService from "@/services/team.service";
import tournamentService from "@/services/tournament.service";
import adminService from "@/services/admin.service";
import { Team } from "@/types/team.types";
import { TeamCreateInput, TeamUpdateInput } from "@/types/admin.types";
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

interface TeamFormData {
  name: string;
  balancer_name: string;
  tournament_id: number;
  captain_id: number;
  avg_sr: number;
  total_sr: number;
}

const defaultFormData: TeamFormData = {
  name: "",
  balancer_name: "",
  tournament_id: 0,
  captain_id: 0,
  avg_sr: 0,
  total_sr: 0,
};

function getCreateTeamForm(tournamentId: number | null): TeamFormData {
  return { ...defaultFormData, tournament_id: tournamentId || 0 };
}

function getEditTeamForm(team: Team): TeamFormData {
  return {
    ...defaultFormData,
    name: team.name,
    avg_sr: team.avg_sr,
    total_sr: team.total_sr,
  };
}

export default function TeamsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const queryClient = useQueryClient();
  const canCreate = hasPermission("team.create");
  const canUpdate = hasPermission("team.update");
  const canDelete = hasPermission("team.delete");

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [selectedTournamentId, setSelectedTournamentId] = useState<number | null>(null);

  // Fetch tournaments for selector
  const { data: tournamentsData } = useQuery({
    queryKey: ["tournaments"],
    queryFn: () => tournamentService.getAll(null)
  });

  // Form state
  const [formData, setFormData] = useState<TeamFormData>({ ...defaultFormData });

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data: TeamCreateInput) => adminService.createTeam(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      setCreateDialogOpen(false);
      resetForm();
      toast({ title: "Team created successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: TeamUpdateInput }) =>
      adminService.updateTeam(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      setEditDialogOpen(false);
      setSelectedTeam(null);
      resetForm();
      toast({ title: "Team updated successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => adminService.deleteTeam(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      setDeleteDialogOpen(false);
      setSelectedTeam(null);
      toast({ title: "Team deleted successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });

  const resetForm = () => {
    setFormData(getCreateTeamForm(selectedTournamentId));
  };

  const handleCreate = () => {
    createMutation.reset();
    setCreateDialogOpen(true);
    resetForm();
  };

  const handleEdit = (team: Team) => {
    updateMutation.reset();
    setSelectedTeam(team);
    setFormData(getEditTeamForm(team));
    setEditDialogOpen(true);
  };

  const handleDelete = (team: Team) => {
    setSelectedTeam(team);
    setDeleteDialogOpen(true);
  };

  const handleSubmitCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const { balancer_name, ...rest } = formData;
    createMutation.mutate(rest);
  };

  const handleSubmitUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedTeam) {
      const { name, captain_id, avg_sr, total_sr } = formData;
      updateMutation.mutate({
        id: selectedTeam.id,
        data: { name, captain_id, avg_sr, total_sr },
      });
    }
  };

  const handleConfirmDelete = () => {
    if (selectedTeam) {
      deleteMutation.mutate(selectedTeam.id);
    }
  };

  const createFormInitial = getCreateTeamForm(selectedTournamentId);
  const editFormInitial = selectedTeam ? getEditTeamForm(selectedTeam) : createFormInitial;
  const isCreateDirty = createDialogOpen && hasUnsavedChanges(formData, createFormInitial);
  const isEditDirty = editDialogOpen && hasUnsavedChanges(formData, editFormInitial);

  const columns: ColumnDef<Team>[] = [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => <div className="font-medium">{row.getValue("name")}</div>
    },
    {
      accessorKey: "avg_sr",
      header: "Avg SR",
      cell: ({ row }) => <div>{row.getValue<number>("avg_sr").toFixed(0)}</div>
    },
    {
      accessorKey: "total_sr",
      header: "Total SR",
      cell: ({ row }) => <div>{row.getValue("total_sr")}</div>
    },
    {
      accessorKey: "players",
      header: "Players",
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <Users className="h-4 w-4" />
          {row.getValue<any[]>("players")?.length || 0}
        </div>
      )
    },
    {
      accessorKey: "tournament",
      header: "Tournament",
      cell: ({ row }) => {
        const tournament = row.getValue<any>("tournament");
        return tournament ? (
          <div className="text-sm text-muted-foreground">
            {tournament.is_league ? tournament.name : `Tournament ${tournament.number}`}
          </div>
        ) : (
          "—"
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
        title="Teams"
        description="Manage teams and their rosters"
        actions={
          canCreate ? (
            <Button onClick={handleCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Create Team
            </Button>
          ) : null
        }
      />

      <div className="flex items-center gap-4">
        <Label htmlFor="tournament-filter">Filter by Tournament:</Label>
        <Select
          value={selectedTournamentId?.toString() || "all"}
          onValueChange={(value) =>
            setSelectedTournamentId(value === "all" ? null : parseInt(value))
          }
        >
          <SelectTrigger className="w-[300px]">
            <SelectValue placeholder="All Tournaments" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Tournaments</SelectItem>
            {tournamentsData?.results.map((tournament) => (
              <SelectItem key={tournament.id} value={tournament.id.toString()}>
                {tournament.is_league ? tournament.name : `Tournament ${tournament.number}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <AdminDataTable
        queryKey={(page, search) => ["teams", selectedTournamentId, page, search]}
        queryFn={async (page, search) => {
          if (!selectedTournamentId) {
            return { results: [], total: 0, page: 1, per_page: 15 };
          }
          const data = await teamService.getAll(selectedTournamentId);
          return {
            ...data,
            results: search
              ? data.results.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()))
              : data.results
          };
        }}
        columns={columns}
        searchPlaceholder="Search teams..."
        emptyMessage={
          selectedTournamentId ? "No teams found in this tournament." : "Select a tournament to view teams."
        }
        onRowClick={(row) => router.push(`/admin/teams/${row.original.id}`)}
      />

      {/* Create Dialog */}
      <EntityFormDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        title="Create Team"
        description="Create a new team"
        onSubmit={handleSubmitCreate}
        isSubmitting={createMutation.isPending}
        submittingLabel="Creating team…"
        errorMessage={createMutation.isError ? createMutation.error.message : undefined}
        isDirty={isCreateDirty}
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="tournament_id">Tournament *</Label>
            <Select
              value={formData.tournament_id?.toString()}
              onValueChange={(value) =>
                setFormData({ ...formData, tournament_id: parseInt(value) })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select tournament" />
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

          <div>
            <Label htmlFor="name">Team Name *</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
          </div>

          <div>
            <Label htmlFor="balancer_name">Balancer Name</Label>
            <Input
              id="balancer_name"
              value={formData.balancer_name || ""}
              onChange={(e) => setFormData({ ...formData, balancer_name: e.target.value })}
            />
          </div>

          <div>
            <Label htmlFor="captain_id">Captain User ID *</Label>
            <Input
              id="captain_id"
              type="number"
              value={formData.captain_id}
              onChange={(e) =>
                setFormData({ ...formData, captain_id: parseInt(e.target.value) })
              }
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="avg_sr">Average SR</Label>
              <Input
                id="avg_sr"
                type="number"
                step="0.1"
                value={formData.avg_sr}
                onChange={(e) =>
                  setFormData({ ...formData, avg_sr: parseFloat(e.target.value) })
                }
              />
            </div>

            <div>
              <Label htmlFor="total_sr">Total SR</Label>
              <Input
                id="total_sr"
                type="number"
                value={formData.total_sr}
                onChange={(e) =>
                  setFormData({ ...formData, total_sr: parseInt(e.target.value) })
                }
              />
            </div>
          </div>
        </div>
      </EntityFormDialog>

      {/* Edit Dialog */}
      <EntityFormDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        title="Edit Team"
        description="Update team details"
        onSubmit={handleSubmitUpdate}
        isSubmitting={updateMutation.isPending}
        submittingLabel="Updating team…"
        errorMessage={updateMutation.isError ? updateMutation.error.message : undefined}
        isDirty={isEditDirty}
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="edit-name">Team Name</Label>
            <Input
              id="edit-name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </div>

          <div>
            <Label htmlFor="edit-captain_id">Captain User ID</Label>
            <Input
              id="edit-captain_id"
              type="number"
              value={formData.captain_id}
              onChange={(e) =>
                setFormData({ ...formData, captain_id: parseInt(e.target.value) })
              }
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="edit-avg_sr">Average SR</Label>
              <Input
                id="edit-avg_sr"
                type="number"
                step="0.1"
                value={formData.avg_sr}
                onChange={(e) =>
                  setFormData({ ...formData, avg_sr: parseFloat(e.target.value) })
                }
              />
            </div>

            <div>
              <Label htmlFor="edit-total_sr">Total SR</Label>
              <Input
                id="edit-total_sr"
                type="number"
                value={formData.total_sr}
                onChange={(e) =>
                  setFormData({ ...formData, total_sr: parseInt(e.target.value) })
                }
              />
            </div>
          </div>
        </div>
      </EntityFormDialog>

      {/* Delete Dialog */}
      {canDelete ? (
        <DeleteConfirmDialog
          open={deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
          onConfirm={handleConfirmDelete}
          title="Delete Team"
          description={`Are you sure you want to delete "${selectedTeam?.name}"? This action cannot be undone.`}
          cascadeInfo={["All players in this team", "All related match statistics"]}
          isDeleting={deleteMutation.isPending}
        />
      ) : null}
    </div>
  );
}
