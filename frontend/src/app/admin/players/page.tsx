"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ColumnDef } from "@tanstack/react-table";
import { ArrowLeftRight, Plus, Pencil, Sparkles, Star, StarHalf, Trash2 } from "lucide-react";
import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatusIcon } from "@/components/admin/StatusIcon";
import { EntityFormDialog } from "@/components/admin/EntityFormDialog";
import { DeleteConfirmDialog } from "@/components/admin/DeleteConfirmDialog";
import { UserSearchCombobox } from "@/components/admin/UserSearchCombobox";
import Image from "next/image";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import teamService from "@/services/team.service";
import tournamentService from "@/services/tournament.service";
import adminService from "@/services/admin.service";
import { Player, Team } from "@/types/team.types";
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
import { MinimizedUser } from "@/types/user.types";
import { paginateResults, sortArray } from "@/lib/paginate-results";

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

type PlayerRow = Player & { team: Team };

type PlayerRoleOption = "Tank" | "Damage" | "Support";

const PLAYER_ROLE_OPTIONS: PlayerRoleOption[] = ["Tank", "Damage", "Support"];

function normalizePlayerRole(role: string | null | undefined): PlayerRoleOption {
  const normalized = role?.trim().toLowerCase();

  if (normalized === "tank") {
    return "Tank";
  }

  if (normalized === "dps" || normalized === "damage") {
    return "Damage";
  }

  if (normalized === "support") {
    return "Support";
  }

  return "Damage";
}

function RoleOptionContent({ role }: { role: PlayerRoleOption }) {
  return (
    <div className="flex items-center gap-2">
      <PlayerRoleIcon role={role} size={18} />
      <span>{role}</span>
    </div>
  );
}

const defaultFormData: PlayerFormData = {
  name: "",
  user_id: 0,
  team_id: 0,
  tournament_id: 0,
  role: "Damage",
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
    role: normalizePlayerRole(player.role),
    rank: player.rank,
    division: player.division,
    is_primary: player.primary,
    is_secondary: player.secondary,
    is_newcomer: player.is_newcomer,
    is_newcomer_role: player.is_newcomer_role,
    is_substitution: player.is_substitution,
  };
}

function buildPlayerRows(teams: Team[]): PlayerRow[] {
  return teams.flatMap((team) =>
    (team.players ?? []).map((player) => ({
      ...player,
      team,
    }))
  );
}

function buildPlayerCreateInput(formData: PlayerFormData): PlayerCreateInput {
  return {
    name: formData.name.trim(),
    user_id: formData.user_id,
    team_id: formData.team_id,
    tournament_id: formData.tournament_id,
    role: normalizePlayerRole(formData.role),
    rank: formData.rank,
    div: formData.division,
    primary: formData.is_primary,
    secondary: formData.is_secondary,
    is_newcomer: formData.is_newcomer,
    is_newcomer_role: formData.is_newcomer_role,
    is_substitution: formData.is_substitution,
  };
}

function buildPlayerUpdateInput(formData: PlayerFormData): PlayerUpdateInput {
  return {
    name: formData.name.trim(),
    role: normalizePlayerRole(formData.role),
    rank: formData.rank,
    div: formData.division,
    primary: formData.is_primary,
    secondary: formData.is_secondary,
    is_newcomer: formData.is_newcomer,
    is_newcomer_role: formData.is_newcomer_role,
    is_substitution: formData.is_substitution,
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
  const [selectedUserName, setSelectedUserName] = useState("");

  // Fetch tournaments and teams
  const { data: tournamentsData } = useQuery({
    queryKey: ["tournaments"],
    queryFn: () => tournamentService.getAll(null)
  });

  const { data: teamsData } = useQuery({
    queryKey: ["teams", selectedTournamentId],
    queryFn: () => teamService.getAll(selectedTournamentId),
  });

  // Form state
  const [formData, setFormData] = useState<PlayerFormData>({ ...defaultFormData });

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data: PlayerCreateInput) => adminService.createPlayer(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["players"] });
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
      queryClient.invalidateQueries({ queryKey: ["players"] });
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
      queryClient.invalidateQueries({ queryKey: ["players"] });
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
    setSelectedUserName("");
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

    if (!formData.name.trim()) {
      toast({ title: "Missing player name", description: "Enter a player name before saving.", variant: "destructive" });
      return;
    }

    if (formData.user_id <= 0) {
      toast({ title: "Missing user", description: "Select a user from the search field before saving.", variant: "destructive" });
      return;
    }

    if (formData.team_id <= 0) {
      toast({ title: "Missing team", description: "Select a team before saving.", variant: "destructive" });
      return;
    }

    createMutation.mutate(buildPlayerCreateInput(formData));
  };

  const handleSubmitUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedPlayer) {
      updateMutation.mutate({
        id: selectedPlayer.id,
        data: buildPlayerUpdateInput(formData),
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

  const columns: ColumnDef<PlayerRow>[] = [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => <div className="font-medium">{row.getValue("name")}</div>
    },
    {
      accessorKey: "role",
      header: "Role",
      cell: ({ row }) => (
        <div className="flex items-center" title={normalizePlayerRole(row.getValue<string>("role"))}>
          <PlayerRoleIcon role={normalizePlayerRole(row.getValue<string>("role"))} size={18} />
        </div>
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
      cell: ({ row }) => <div className="flex justify-start"><Image src={`/divisions/${row.getValue<number>("division")}.png`} alt={`Division ${row.getValue<number>("division")}`} width={28} height={28} /></div>
    },
    {
      accessorKey: "team",
      header: "Team",
      enableSorting: false,
      cell: ({ row }) => {
        const team = row.getValue<Team>("team");
        return team ? <div className="text-sm">{team.name}</div> : "—";
      }
    },
    {
      id: "flags",
      header: "Flags",
      cell: ({ row }) => (
        <div className="flex gap-1">
          {row.original.is_newcomer && <StatusIcon icon={Sparkles} label="Newcomer" variant="warning" />}
          {row.original.is_substitution && <StatusIcon icon={ArrowLeftRight} label="Substitute" variant="info" />}
          {row.original.primary && <StatusIcon icon={Star} label="Primary" variant="success" />}
          {row.original.secondary && <StatusIcon icon={StarHalf} label="Secondary" variant="muted" />}
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
                {tournament.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <AdminDataTable
        queryKey={(page, search, pageSize, sortField, sortDir) => ["players", selectedTournamentId, page, search, pageSize, sortField, sortDir]}
        queryFn={async (page, search, pageSize, sortField, sortDir) => {
          const data = await teamService.getAll(selectedTournamentId);
          const players = buildPlayerRows(data.results);
          const normalizedSearch = search.trim().toLowerCase();
          const filtered = normalizedSearch
            ? players.filter((player) => player.name.toLowerCase().includes(normalizedSearch))
            : players;
          const sorted = sortArray(filtered, sortField, sortDir);

          return paginateResults(sorted, page, pageSize);
        }}
        columns={columns}
        searchPlaceholder="Search players..."
        emptyMessage="No players found."
        onRowDoubleClick={canUpdate ? (row) => handleEdit(row.original) : undefined}
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
              value={formData.team_id ? formData.team_id.toString() : ""}
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
            <Label htmlFor="user_id">User *</Label>
            <UserSearchCombobox
              value={formData.user_id || undefined}
              selectedName={selectedUserName || undefined}
              placeholder="Search user by name"
              searchPlaceholder="Search user by name..."
              onSelect={(user: MinimizedUser | undefined) => {
                setSelectedUserName(user?.name ?? "");
                setFormData((current) => ({
                  ...current,
                  user_id: user?.id ?? 0,
                  name: current.name || user?.name || "",
                }));
              }}
            />
          </div>

          <div>
            <Label htmlFor="role">Role</Label>
            <Select
              value={normalizePlayerRole(formData.role)}
              onValueChange={(value) => setFormData({ ...formData, role: value })}
            >
              <SelectTrigger>
                <RoleOptionContent role={normalizePlayerRole(formData.role)} />
              </SelectTrigger>
              <SelectContent>
                {PLAYER_ROLE_OPTIONS.map((role) => (
                  <SelectItem key={role} value={role}>
                    <RoleOptionContent role={role} />
                  </SelectItem>
                ))}
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
              value={normalizePlayerRole(formData.role)}
              onValueChange={(value) => setFormData({ ...formData, role: value })}
            >
              <SelectTrigger>
                <RoleOptionContent role={normalizePlayerRole(formData.role)} />
              </SelectTrigger>
              <SelectContent>
                {PLAYER_ROLE_OPTIONS.map((role) => (
                  <SelectItem key={role} value={role}>
                    <RoleOptionContent role={role} />
                  </SelectItem>
                ))}
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
