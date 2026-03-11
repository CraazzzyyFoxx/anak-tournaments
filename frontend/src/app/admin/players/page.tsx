"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ColumnDef } from "@tanstack/react-table";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { EntityFormDialog } from "@/components/admin/EntityFormDialog";
import { DeleteConfirmDialog } from "@/components/admin/DeleteConfirmDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import teamService from "@/services/team.service";
import tournamentService from "@/services/tournament.service";
import adminService from "@/services/admin.service";
import { Player } from "@/types/team.types";
import { PlayerCreateInput, PlayerUpdateInput } from "@/types/admin.types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { usePermissions } from "@/hooks/usePermissions";
import { hasUnsavedChanges } from "@/lib/form-change";

interface PlayerFormData {
  name: string;
  user_id: number;
  team_id: number;
  tournament_id: number;
  role: string;
  rank: number;
  division: number;
  is_primary: boolean;
  is_secondary: boolean;
  is_newcomer: boolean;
  is_newcomer_role: boolean;
  is_substitution: boolean;
}

const defaultFormData: PlayerFormData = {
  name: "",
  user_id: 0,
  team_id: 0,
  tournament_id: 0,
  role: "dps",
  rank: 0,
  division: 0,
  is_primary: false,
  is_secondary: false,
  is_newcomer: false,
  is_newcomer_role: false,
  is_substitution: false,
};

function getCreatePlayerForm(tournamentId: number | null): PlayerFormData {
  return { ...defaultFormData, tournament_id: tournamentId || 0 };
}

function getEditPlayerForm(player: Player): PlayerFormData {
  return {
    ...defaultFormData,
    name: player.name,
    role: player.role,
    rank: player.rank,
    division: player.division,
    is_primary: player.primary,
    is_secondary: player.secondary,
    is_newcomer: player.is_newcomer,
    is_newcomer_role: player.is_newcomer_role,
    is_substitution: player.is_substitution,
  };
}

export default function PlayersPage() {
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const queryClient = useQueryClient();
  const canCreate = hasPermission("player.create");
  const canUpdate = hasPermission("player.update");
  const canDelete = hasPermission("player.delete");

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
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
  const [formData, setFormData] = useState<PlayerFormData>({ ...defaultFormData });

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data: PlayerCreateInput) => adminService.createPlayer(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      setCreateDialogOpen(false);
      resetForm();
      toast({ title: "Player created successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: PlayerUpdateInput }) =>
      adminService.updatePlayer(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      setEditDialogOpen(false);
      setSelectedPlayer(null);
      resetForm();
      toast({ title: "Player updated successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => adminService.deletePlayer(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      setDeleteDialogOpen(false);
      setSelectedPlayer(null);
      toast({ title: "Player deleted successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });

  const resetForm = () => {
    setFormData(getCreatePlayerForm(selectedTournamentId));
  };

  const handleCreate = () => {
    createMutation.reset();
    setCreateDialogOpen(true);
    resetForm();
  };

  const handleEdit = (player: Player) => {
    updateMutation.reset();
    setSelectedPlayer(player);
    setFormData(getEditPlayerForm(player));
    setEditDialogOpen(true);
  };

  const handleDelete = (player: Player) => {
    setSelectedPlayer(player);
    setDeleteDialogOpen(true);
  };

  const handleSubmitCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const { name, tournament_id, ...rest } = formData;
    createMutation.mutate(rest);
  };

  const handleSubmitUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedPlayer) {
      const { role, rank, division, is_primary, is_secondary, is_newcomer, is_newcomer_role, is_substitution } = formData;
      updateMutation.mutate({
        id: selectedPlayer.id,
        data: { role, rank, division, is_primary, is_secondary, is_newcomer, is_newcomer_role, is_substitution },
      });
    }
  };

  const handleConfirmDelete = () => {
    if (selectedPlayer) {
      deleteMutation.mutate(selectedPlayer.id);
    }
  };

  const createFormInitial = getCreatePlayerForm(selectedTournamentId);
  const editFormInitial = selectedPlayer ? getEditPlayerForm(selectedPlayer) : createFormInitial;
  const isCreateDirty = createDialogOpen && hasUnsavedChanges(formData, createFormInitial);
  const isEditDirty = editDialogOpen && hasUnsavedChanges(formData, editFormInitial);

  // Flatten players from all teams
  const allPlayers = teamsData?.results.flatMap((team) =>
    team.players?.map((player: Player) => ({ ...player, team })) || []
  ) || [];

  const columns: ColumnDef<Player & { team?: any }>[] = [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => <div className="font-medium">{row.getValue("name")}</div>
    },
    {
      accessorKey: "role",
      header: "Role",
      cell: ({ row }) => (
        <Badge variant="outline" className="capitalize">
          {row.getValue("role")}
        </Badge>
      )
    },
    {
      accessorKey: "rank",
      header: "Rank",
      cell: ({ row }) => <div>{row.getValue("rank")}</div>
    },
    {
      accessorKey: "division",
      header: "Div",
      cell: ({ row }) => <div>{row.getValue("division")}</div>
    },
    {
      accessorKey: "team",
      header: "Team",
      cell: ({ row }) => {
        const team = row.getValue<any>("team");
        return team ? <div className="text-sm">{team.name}</div> : "—";
      }
    },
    {
      id: "flags",
      header: "Flags",
      cell: ({ row }) => (
        <div className="flex gap-1">
          {row.original.is_newcomer && <Badge variant="secondary">New</Badge>}
          {row.original.is_substitution && <Badge variant="secondary">Sub</Badge>}
          {row.original.primary && <Badge variant="default">Primary</Badge>}
          {row.original.secondary && <Badge variant="default">Secondary</Badge>}
        </div>
      )
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
        title="Players"
        description="Manage players across all teams"
        actions={
          canCreate ? (
            <Button onClick={handleCreate} disabled={!selectedTournamentId}>
              <Plus className="mr-2 h-4 w-4" />
              Create Player
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
        queryKey={(page, search) => ["players", selectedTournamentId, page, search]}
        queryFn={async (page, search) => {
          const filtered = search
            ? allPlayers.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
            : allPlayers;
          return {
            results: filtered,
            total: filtered.length,
            page: 1,
            per_page: filtered.length
          };
        }}
        columns={columns}
        searchPlaceholder="Search players..."
        emptyMessage={
          selectedTournamentId
            ? "No players found in this tournament."
            : "Select a tournament to view players."
        }
      />

      {/* Create Dialog */}
      <EntityFormDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        title="Create Player"
        description="Add a new player to a team"
        onSubmit={handleSubmitCreate}
        isSubmitting={createMutation.isPending}
        submittingLabel="Creating player…"
        errorMessage={createMutation.isError ? createMutation.error.message : undefined}
        isDirty={isCreateDirty}
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="team_id">Team *</Label>
            <Select
              value={formData.team_id?.toString()}
              onValueChange={(value) => setFormData({ ...formData, team_id: parseInt(value) })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select team" />
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
            <Label htmlFor="name">Player Name *</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
          </div>

          <div>
            <Label htmlFor="user_id">User ID *</Label>
            <Input
              id="user_id"
              type="number"
              value={formData.user_id}
              onChange={(e) =>
                setFormData({ ...formData, user_id: parseInt(e.target.value) })
              }
              required
            />
          </div>

          <div>
            <Label htmlFor="role">Role</Label>
            <Select
              value={formData.role || "dps"}
              onValueChange={(value) => setFormData({ ...formData, role: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tank">Tank</SelectItem>
                <SelectItem value="dps">DPS</SelectItem>
                <SelectItem value="support">Support</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="rank">Rank</Label>
              <Input
                id="rank"
                type="number"
                value={formData.rank}
                onChange={(e) => setFormData({ ...formData, rank: parseInt(e.target.value) })}
              />
            </div>

            <div>
              <Label htmlFor="div">Division</Label>
              <Input
                id="div"
                type="number"
                value={formData.division}
                onChange={(e) => setFormData({ ...formData, division: parseInt(e.target.value) })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="is_primary"
                checked={formData.is_primary}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, is_primary: checked as boolean })
                }
              />
              <Label htmlFor="is_primary" className="cursor-pointer">
                Primary Role
              </Label>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="is_secondary"
                checked={formData.is_secondary}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, is_secondary: checked as boolean })
                }
              />
              <Label htmlFor="is_secondary" className="cursor-pointer">
                Secondary Role
              </Label>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="is_newcomer"
                checked={formData.is_newcomer}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, is_newcomer: checked as boolean })
                }
              />
              <Label htmlFor="is_newcomer" className="cursor-pointer">
                Newcomer
              </Label>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="is_substitution"
                checked={formData.is_substitution}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, is_substitution: checked as boolean })
                }
              />
              <Label htmlFor="is_substitution" className="cursor-pointer">
                Substitution
              </Label>
            </div>
          </div>
        </div>
      </EntityFormDialog>

      {/* Edit Dialog */}
      <EntityFormDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        title="Edit Player"
        description="Update player details"
        onSubmit={handleSubmitUpdate}
        isSubmitting={updateMutation.isPending}
        submittingLabel="Updating player…"
        errorMessage={updateMutation.isError ? updateMutation.error.message : undefined}
        isDirty={isEditDirty}
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="edit-name">Player Name</Label>
            <Input
              id="edit-name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </div>

          <div>
            <Label htmlFor="edit-role">Role</Label>
            <Select
              value={formData.role || "dps"}
              onValueChange={(value) => setFormData({ ...formData, role: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tank">Tank</SelectItem>
                <SelectItem value="dps">DPS</SelectItem>
                <SelectItem value="support">Support</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="edit-rank">Rank</Label>
              <Input
                id="edit-rank"
                type="number"
                value={formData.rank}
                onChange={(e) => setFormData({ ...formData, rank: parseInt(e.target.value) })}
              />
            </div>

            <div>
              <Label htmlFor="edit-div">Division</Label>
              <Input
                id="edit-div"
                type="number"
                value={formData.division}
                onChange={(e) => setFormData({ ...formData, division: parseInt(e.target.value) })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="edit-is_primary"
                checked={formData.is_primary}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, is_primary: checked as boolean })
                }
              />
              <Label htmlFor="edit-is_primary" className="cursor-pointer">
                Primary Role
              </Label>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="edit-is_secondary"
                checked={formData.is_secondary}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, is_secondary: checked as boolean })
                }
              />
              <Label htmlFor="edit-is_secondary" className="cursor-pointer">
                Secondary Role
              </Label>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="edit-is_newcomer"
                checked={formData.is_newcomer}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, is_newcomer: checked as boolean })
                }
              />
              <Label htmlFor="edit-is_newcomer" className="cursor-pointer">
                Newcomer
              </Label>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="edit-is_substitution"
                checked={formData.is_substitution}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, is_substitution: checked as boolean })
                }
              />
              <Label htmlFor="edit-is_substitution" className="cursor-pointer">
                Substitution
              </Label>
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
          title="Delete Player"
          description={`Are you sure you want to delete "${selectedPlayer?.name}"? This action cannot be undone.`}
          isDeleting={deleteMutation.isPending}
        />
      ) : null}
    </div>
  );
}
