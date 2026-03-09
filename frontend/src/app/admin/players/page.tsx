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

export default function PlayersPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

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
  const [formData, setFormData] = useState<PlayerCreateInput | PlayerUpdateInput>({
    name: "",
    user_id: 0,
    team_id: 0,
    tournament_id: 0,
    role: "dps",
    rank: 0,
    div: 0,
    primary: false,
    secondary: false,
    is_newcomer: false,
    is_newcomer_role: false,
    is_substitution: false
  });

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
    setFormData({
      name: "",
      user_id: 0,
      team_id: 0,
      tournament_id: selectedTournamentId || 0,
      role: "dps",
      rank: 0,
      div: 0,
      primary: false,
      secondary: false,
      is_newcomer: false,
      is_newcomer_role: false,
      is_substitution: false
    });
  };

  const handleCreate = () => {
    setCreateDialogOpen(true);
    resetForm();
  };

  const handleEdit = (player: Player) => {
    setSelectedPlayer(player);
    setFormData({
      name: player.name,
      role: player.role,
      rank: player.rank,
      div: player.division,
      primary: player.primary,
      secondary: player.secondary,
      is_newcomer: player.is_newcomer,
      is_newcomer_role: player.is_newcomer_role,
      is_substitution: player.is_substitution
    });
    setEditDialogOpen(true);
  };

  const handleDelete = (player: Player) => {
    setSelectedPlayer(player);
    setDeleteDialogOpen(true);
  };

  const handleSubmitCreate = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(formData as PlayerCreateInput);
  };

  const handleSubmitUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedPlayer) {
      updateMutation.mutate({
        id: selectedPlayer.id,
        data: formData as PlayerUpdateInput
      });
    }
  };

  const handleConfirmDelete = () => {
    if (selectedPlayer) {
      deleteMutation.mutate(selectedPlayer.id);
    }
  };

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
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => handleEdit(row.original)}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => handleDelete(row.original)}
            className="text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      )
    }
  ];

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title="Players"
        description="Manage players across all teams"
        actions={
          <Button onClick={handleCreate} disabled={!selectedTournamentId}>
            <Plus className="mr-2 h-4 w-4" />
            Create Player
          </Button>
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
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="team_id">Team *</Label>
            <Select
              value={(formData as PlayerCreateInput).team_id?.toString()}
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
              value={(formData as PlayerCreateInput).name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
          </div>

          <div>
            <Label htmlFor="user_id">User ID *</Label>
            <Input
              id="user_id"
              type="number"
              value={(formData as PlayerCreateInput).user_id}
              onChange={(e) =>
                setFormData({ ...formData, user_id: parseInt(e.target.value) })
              }
              required
            />
          </div>

          <div>
            <Label htmlFor="role">Role</Label>
            <Select
              value={(formData as PlayerCreateInput).role || "dps"}
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
                value={(formData as PlayerCreateInput).rank}
                onChange={(e) => setFormData({ ...formData, rank: parseInt(e.target.value) })}
              />
            </div>

            <div>
              <Label htmlFor="div">Division</Label>
              <Input
                id="div"
                type="number"
                value={(formData as PlayerCreateInput).div}
                onChange={(e) => setFormData({ ...formData, div: parseInt(e.target.value) })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="primary"
                checked={(formData as PlayerCreateInput).primary}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, primary: checked as boolean })
                }
              />
              <Label htmlFor="primary" className="cursor-pointer">
                Primary Role
              </Label>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="secondary"
                checked={(formData as PlayerCreateInput).secondary}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, secondary: checked as boolean })
                }
              />
              <Label htmlFor="secondary" className="cursor-pointer">
                Secondary Role
              </Label>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="is_newcomer"
                checked={(formData as PlayerCreateInput).is_newcomer}
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
                checked={(formData as PlayerCreateInput).is_substitution}
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
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="edit-name">Player Name</Label>
            <Input
              id="edit-name"
              value={(formData as PlayerUpdateInput).name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </div>

          <div>
            <Label htmlFor="edit-role">Role</Label>
            <Select
              value={(formData as PlayerUpdateInput).role || "dps"}
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
                value={(formData as PlayerUpdateInput).rank}
                onChange={(e) => setFormData({ ...formData, rank: parseInt(e.target.value) })}
              />
            </div>

            <div>
              <Label htmlFor="edit-div">Division</Label>
              <Input
                id="edit-div"
                type="number"
                value={(formData as PlayerUpdateInput).div}
                onChange={(e) => setFormData({ ...formData, div: parseInt(e.target.value) })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="edit-primary"
                checked={(formData as PlayerUpdateInput).primary}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, primary: checked as boolean })
                }
              />
              <Label htmlFor="edit-primary" className="cursor-pointer">
                Primary Role
              </Label>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="edit-secondary"
                checked={(formData as PlayerUpdateInput).secondary}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, secondary: checked as boolean })
                }
              />
              <Label htmlFor="edit-secondary" className="cursor-pointer">
                Secondary Role
              </Label>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="edit-is_newcomer"
                checked={(formData as PlayerUpdateInput).is_newcomer}
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
                checked={(formData as PlayerUpdateInput).is_substitution}
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
      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={handleConfirmDelete}
        title="Delete Player"
        description={`Are you sure you want to delete "${selectedPlayer?.name}"? This action cannot be undone.`}
        isDeleting={deleteMutation.isPending}
      />
    </div>
  );
}
