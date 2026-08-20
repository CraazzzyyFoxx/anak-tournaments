"use client";

import { useId, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ColumnDef } from "@tanstack/react-table";
import {
  ArrowLeftRight,
  Plus,
  Sparkles
} from "lucide-react";
import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminCombobox, AdminComboboxCheck } from "@/components/admin/AdminCombobox";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatusIcon } from "@/components/admin/StatusIcon";
import { EntityFormDialog } from "@/components/admin/EntityFormDialog";
import { DeleteConfirmDialog } from "@/components/admin/DeleteConfirmDialog";
import { createRowActionsColumn } from "@/components/admin/row-actions-column";
import {
  TOURNAMENT_QUERY_PARAM,
  parseTournamentQueryParam,
  nextTournamentFilterQuery,
  TournamentFilterSelect
} from "@/components/admin/tournament-filter";
import { UserSearchCombobox } from "@/components/admin/UserSearchCombobox";
import { TeamCombobox } from "@/components/admin/TeamCombobox";
import DivisionIcon from "@/components/DivisionIcon";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import { Button } from "@/components/ui/button";
import { notify } from "@/lib/notify";
import teamService from "@/services/team.service";
import tournamentService from "@/services/tournament.service";
import adminService from "@/services/admin.service";
import { Player, Team } from "@/types/team.types";
import { PlayerCreateInput, PlayerUpdateInput } from "@/types/admin.types";
import { formatSubRoleLabel } from "@/utils/player";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { CommandGroup, CommandItem } from "@/components/ui/command";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger
} from "@/components/ui/select";
import { usePermissions } from "@/hooks/usePermissions";
import {
  PLAYER_ROLE_OPTIONS,
  filterSubRoleOptions,
  normalizePlayerRole,
  subRoleCatalogRole,
  type PlayerRoleOption
} from "@/lib/player-role";
import { hasUnsavedChanges } from "@/lib/form-change";
import { resolveDivisionFromRank } from "@/lib/division-grid";
import { useDivisionGrid } from "@/hooks/useCurrentWorkspace";
import type { DivisionGridVersion } from "@/types/workspace.types";
import { MinimizedUser } from "@/types/user.types";
import { paginateResults, sortArray } from "@/lib/paginate-results";
import { useWorkspaceStore } from "@/stores/workspace.store";
import { getPlayerRowDivisionGrid } from "@/app/admin/players/playerRowDivisionGrid";

/** Shown on the sub-role field for a role the sub-role catalog has no rows for. */
const NO_SUB_ROLE_CATALOG_PLACEHOLDER = "No sub-roles for this role";

interface PlayerFormData {
  name: string;
  user_id: number;
  team_id: number;
  tournament_id: number;
  role: string;
  sub_role: string;
  rank: number;
  is_newcomer: boolean;
  is_substitution: boolean;
}

type PlayerRow = Player & { team: Team };

function RoleOptionContent({ role }: Readonly<{ role: PlayerRoleOption }>) {
  return (
    <div className="flex items-center gap-2">
      <PlayerRoleIcon role={role} size={18} decorative />
      <span>{role}</span>
    </div>
  );
}

interface PlayerOption {
  value: string;
  label: string;
  meta?: string;
}

interface SearchableSelectProps {
  id?: string;
  value: string;
  options: PlayerOption[];
  onChange: (value: string) => void;
  placeholder: string;
  searchPlaceholder: string;
  emptyMessage: string;
  disabled?: boolean;
}

function SearchableSelect({
  id,
  value,
  options,
  onChange,
  placeholder,
  searchPlaceholder,
  emptyMessage,
  disabled = false
}: Readonly<SearchableSelectProps>) {
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const selected = options.find((option) => option.value === value);

  return (
    <AdminCombobox
      id={id}
      open={open}
      onOpenChange={setOpen}
      label={selected?.label ?? placeholder}
      disabled={disabled}
      searchValue={searchValue}
      onSearchValueChange={setSearchValue}
      searchPlaceholder={searchPlaceholder}
      emptyMessage={emptyMessage}
    >
      <CommandGroup>
        {options.map((option) => (
          <CommandItem
            key={option.value}
            value={`${option.label} ${option.meta ?? ""} ${option.value}`}
            onSelect={() => {
              onChange(option.value);
              setOpen(false);
              setSearchValue("");
            }}
          >
            <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
              <span className="truncate">{option.label}</span>
              {option.meta ? (
                <span className="shrink-0 text-xs text-muted-foreground">{option.meta}</span>
              ) : null}
            </div>
            <AdminComboboxCheck selected={value === option.value} />
          </CommandItem>
        ))}
      </CommandGroup>
    </AdminCombobox>
  );
}

/**
 * Division is derived from rank by the division grid, so the form renders it
 * read-only as the grid icon instead of an editable number the API discards.
 */
function DivisionField({ rank, grid }: Readonly<{ rank: number; grid: DivisionGridVersion | null }>) {
  const workspaceGrid = useDivisionGrid();
  const division = resolveDivisionFromRank(grid ?? workspaceGrid, rank);

  return (
    <div>
      <Label>Division</Label>
      <div className="flex h-9 items-center">
        {division == null ? (
          <span className="text-sm text-muted-foreground">—</span>
        ) : (
          <DivisionIcon division={division} tournamentGrid={grid} width={28} height={28} />
        )}
      </div>
    </div>
  );
}

const defaultFormData: PlayerFormData = {
  name: "",
  user_id: 0,
  team_id: 0,
  tournament_id: 0,
  role: "Damage",
  sub_role: "",
  rank: 0,
  is_newcomer: false,
  is_substitution: false
};

function getCreatePlayerForm(tournamentId: number | null): PlayerFormData {
  return { ...defaultFormData, tournament_id: tournamentId || 0 };
}

function getEditPlayerForm(player: Player): PlayerFormData {
  return {
    ...defaultFormData,
    name: player.name,
    role: normalizePlayerRole(player.role),
    sub_role: player.sub_role ?? "",
    rank: player.rank,
    is_newcomer: player.is_newcomer,
    is_substitution: player.is_substitution
  };
}

function buildPlayerRows(teams: Team[]): PlayerRow[] {
  return teams.flatMap((team) =>
    (team.players ?? []).map((player) => ({
      ...player,
      team
    }))
  );
}

/**
 * Sub-role fragment of a player payload. A role with no sub-role catalog (Flex)
 * sends an explicit `null`, because omitting the key would leave an already
 * stored sub-role in place on a role that cannot have one.
 */
function buildSubRolePayload(
  role: PlayerRoleOption,
  subRole: string
): { sub_role?: string | null } {
  if (subRoleCatalogRole(role) == null) return { sub_role: null };
  return subRole ? { sub_role: subRole } : {};
}

function buildPlayerCreateInput(formData: PlayerFormData): PlayerCreateInput {
  const role = normalizePlayerRole(formData.role);
  return {
    name: formData.name.trim(),
    user_id: formData.user_id,
    team_id: formData.team_id,
    tournament_id: formData.tournament_id,
    role,
    rank: formData.rank,
    is_newcomer: formData.is_newcomer,
    is_substitution: formData.is_substitution,
    ...buildSubRolePayload(role, formData.sub_role)
  };
}

function buildPlayerUpdateInput(formData: PlayerFormData): PlayerUpdateInput {
  const role = normalizePlayerRole(formData.role);
  return {
    name: formData.name.trim(),
    role,
    rank: formData.rank,
    is_newcomer: formData.is_newcomer,
    is_substitution: formData.is_substitution,
    ...buildSubRolePayload(role, formData.sub_role)
  };
}

/** The role select, identical between the create and edit dialogs apart from the id.
 * Picking a role clears sub_role, since a sub-role only makes sense for its own role. */
function PlayerRoleField({
  id,
  formData,
  setFormData
}: Readonly<{
  id: string;
  formData: PlayerFormData;
  setFormData: React.Dispatch<React.SetStateAction<PlayerFormData>>;
}>) {
  return (
    <div>
      <Label htmlFor={id}>Role</Label>
      <Select
        value={normalizePlayerRole(formData.role)}
        onValueChange={(value) => setFormData({ ...formData, role: value, sub_role: "" })}
      >
        <SelectTrigger id={id}>
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
  );
}

/** The sub-role select, identical between the create and edit dialogs apart from the id. */
function PlayerSubRoleField({
  id,
  formData,
  setFormData,
  hasSubRoleCatalog,
  subRoleSelectOptions
}: Readonly<{
  id: string;
  formData: PlayerFormData;
  setFormData: React.Dispatch<React.SetStateAction<PlayerFormData>>;
  hasSubRoleCatalog: boolean;
  subRoleSelectOptions: PlayerOption[];
}>) {
  return (
    <div>
      <Label htmlFor={id}>Sub-role</Label>
      <SearchableSelect
        id={id}
        value={formData.sub_role || "none"}
        options={subRoleSelectOptions}
        disabled={!hasSubRoleCatalog}
        placeholder={hasSubRoleCatalog ? "Select sub-role" : NO_SUB_ROLE_CATALOG_PLACEHOLDER}
        searchPlaceholder="Search sub-role…"
        emptyMessage="No sub-roles match that search."
        onChange={(value) => {
          const subRole = value === "none" ? "" : value;
          setFormData({ ...formData, sub_role: subRole });
        }}
      />
    </div>
  );
}

export default function PlayersPage() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { canAccessPermission } = usePermissions();
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const queryClient = useQueryClient();
  const canCreate = canAccessPermission("player.create", workspaceId);
  const canUpdate = canAccessPermission("player.update", workspaceId);
  const canDelete = canAccessPermission("player.delete", workspaceId);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerRow | null>(null);
  const selectedTournamentId = parseTournamentQueryParam(searchParams.get(TOURNAMENT_QUERY_PARAM));
  const [selectedUserName, setSelectedUserName] = useState("");
  const createHintId = useId();

  // Fetch tournaments and teams
  const { data: tournamentsData } = useQuery({
    queryKey: ["tournaments"],
    queryFn: () => tournamentService.getAll(null)
  });

  const { data: teamsData } = useQuery({
    queryKey: ["teams", selectedTournamentId],
    queryFn: () => teamService.getAll({ tournamentId: selectedTournamentId })
  });

  const selectedTournament = tournamentsData?.results.find(
    (tournament) => tournament.id === selectedTournamentId
  );
  const selectedWorkspaceId = selectedTournament?.workspace_id;
  const { data: playerSubRoles } = useQuery({
    queryKey: ["player-sub-roles", selectedWorkspaceId],
    queryFn: () => adminService.getPlayerSubRoles({ workspace_id: selectedWorkspaceId! }),
    enabled: Boolean(selectedWorkspaceId)
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
      notify.success("Player created successfully");
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
      notify.success("Player updated successfully");
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => adminService.deletePlayer(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["players"] });
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      setDeleteDialogOpen(false);
      setSelectedPlayer(null);
      notify.success("Player deleted successfully");
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

  const handleEdit = (player: PlayerRow) => {
    updateMutation.reset();
    setSelectedPlayer(player);
    setFormData(getEditPlayerForm(player));
    setEditDialogOpen(true);
  };

  const handleDelete = (player: PlayerRow) => {
    setSelectedPlayer(player);
    setDeleteDialogOpen(true);
  };

  const handleSubmitCreate = (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      notify.error("Missing player name", { description: "Enter a player name before saving." });
      return;
    }

    if (formData.user_id <= 0) {
      notify.error("Missing user", {
        description: "Select a user from the search field before saving."
      });
      return;
    }

    if (formData.team_id <= 0) {
      notify.error("Missing team", { description: "Select a team before saving." });
      return;
    }

    createMutation.mutate(buildPlayerCreateInput(formData));
  };

  const handleSubmitUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedPlayer) {
      updateMutation.mutate({
        id: selectedPlayer.id,
        data: buildPlayerUpdateInput(formData)
      });
    }
  };

  const handleConfirmDelete = () => {
    if (selectedPlayer) {
      deleteMutation.mutate(selectedPlayer.id);
    }
  };

  const handleTournamentFilterChange = (value: string) => {
    const nextTournamentId = value === "all" ? null : Number(value);
    const query = nextTournamentFilterQuery(searchParams.toString(), TOURNAMENT_QUERY_PARAM, value);

    setFormData((current) => ({
      ...current,
      tournament_id: nextTournamentId ?? 0,
      team_id: 0
    }));

    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const createFormInitial = getCreatePlayerForm(selectedTournamentId);
  const editFormInitial = selectedPlayer ? getEditPlayerForm(selectedPlayer) : createFormInitial;
  const isCreateDirty = createDialogOpen && hasUnsavedChanges(formData, createFormInitial);
  const isEditDirty = editDialogOpen && hasUnsavedChanges(formData, editFormInitial);

  // Flex has no sub-role catalog, so its sub-role field is inert rather than a
  // dropdown holding a single unusable "No sub-role" row.
  const hasSubRoleCatalog = subRoleCatalogRole(formData.role) != null;
  const subRoleOptions = filterSubRoleOptions(playerSubRoles, formData.role);
  const hasCurrentSubRoleOption = subRoleOptions.some(
    (subRole) => subRole.slug === formData.sub_role
  );
  const subRoleSelectOptions = useMemo(() => {
    if (!hasSubRoleCatalog) return [];

    const options = [
      { value: "none", label: "No sub-role" },
      ...subRoleOptions.map((subRole) => ({
        value: subRole.slug,
        label: subRole.label,
        meta: subRole.slug
      }))
    ];

    if (formData.sub_role && !hasCurrentSubRoleOption) {
      options.push({
        value: formData.sub_role,
        label: formatSubRoleLabel(formData.sub_role) ?? formData.sub_role,
        meta: "current"
      });
    }

    return options;
  }, [formData.sub_role, hasCurrentSubRoleOption, hasSubRoleCatalog, subRoleOptions]);

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
        <div
          className="flex items-center"
          title={normalizePlayerRole(row.getValue<string>("role"))}
        >
          <PlayerRoleIcon role={normalizePlayerRole(row.getValue<string>("role"))} size={18} />
        </div>
      )
    },
    {
      accessorKey: "rank",
      header: "Rank",
      cell: ({ row }) => <div className="tabular-nums">{row.getValue("rank")}</div>
    },
    {
      accessorKey: "sub_role",
      header: "Sub-role",
      cell: ({ row }) => (
        <div>{formatSubRoleLabel(row.getValue<string | null>("sub_role")) ?? "—"}</div>
      )
    },
    {
      accessorKey: "division",
      header: "Div",
      cell: ({ row }) => (
        <div className="flex justify-start">
          <DivisionIcon
            division={row.getValue<number>("division")}
            tournamentGrid={getPlayerRowDivisionGrid(row.original.team)}
            width={28}
            height={28}
          />
        </div>
      )
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
          {row.original.is_newcomer && (
            <StatusIcon icon={Sparkles} label="Newcomer" variant="warning" />
          )}
          {row.original.is_substitution && (
            <StatusIcon icon={ArrowLeftRight} label="Substitute" variant="info" />
          )}
        </div>
      )
    },
    createRowActionsColumn<PlayerRow>({
      canUpdate,
      canDelete,
      onEdit: handleEdit,
      onDelete: handleDelete,
      getEditLabel: (row) => `Edit ${row.name}`,
      getDeleteLabel: (row) => `Delete ${row.name}`
    })
  ];

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title="Players"
        description="Manage players across all teams"
        actions={
          canCreate ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {!selectedTournamentId ? (
                <span id={createHintId} className="text-sm text-muted-foreground">
                  Pick a tournament first — a player joins a team inside one tournament.
                </span>
              ) : null}
              <Button
                onClick={handleCreate}
                disabled={!selectedTournamentId}
                aria-describedby={!selectedTournamentId ? createHintId : undefined}
              >
                <Plus className="mr-2 h-4 w-4" aria-hidden />
                Create player
              </Button>
            </div>
          ) : null
        }
      />

      <AdminDataTable
        queryKey={(page, search, pageSize, sortField, sortDir) => [
          "players",
          selectedTournamentId,
          page,
          search,
          pageSize,
          sortField,
          sortDir
        ]}
        queryFn={async (page, search, pageSize, sortField, sortDir) => {
          const data = await teamService.getAll({ tournamentId: selectedTournamentId });
          const players = buildPlayerRows(data.results);
          const normalizedSearch = search.trim().toLowerCase();
          const filtered = normalizedSearch
            ? players.filter((player) => player.name.toLowerCase().includes(normalizedSearch))
            : players;
          const sorted = sortArray(filtered, sortField, sortDir);

          return paginateResults(sorted, page, pageSize);
        }}
        columns={columns}
        searchPlaceholder="Search players…"
        emptyMessage={
          selectedTournamentId
            ? "No players in this tournament yet. Use “Create player” to add the first one."
            : "No players yet. Pick a tournament to see or create its players."
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

      {/* Create Dialog */}
      <EntityFormDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        title="Create player"
        description="Add a new player to a team in the selected tournament"
        onSubmit={handleSubmitCreate}
        isSubmitting={createMutation.isPending}
        submittingLabel="Creating player…"
        errorMessage={createMutation.isError ? createMutation.error.message : undefined}
        isDirty={isCreateDirty}
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="team_id">Team *</Label>
            <TeamCombobox
              id="team_id"
              teams={teamsData?.results ?? []}
              value={formData.team_id || null}
              placeholder={
                selectedTournamentId ? "Search and select team" : "Pick a tournament first"
              }
              searchPlaceholder="Search team…"
              disabled={!selectedTournamentId}
              onSelect={(team) => setFormData({ ...formData, team_id: team?.id ?? 0 })}
            />
          </div>

          <div>
            <Label htmlFor="name">Player name *</Label>
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
              id="user_id"
              value={formData.user_id || undefined}
              selectedName={selectedUserName || undefined}
              placeholder="Search user by name"
              searchPlaceholder="Search user by name…"
              onSelect={(user: MinimizedUser | undefined) => {
                setSelectedUserName(user?.name ?? "");
                setFormData((current) => ({
                  ...current,
                  user_id: user?.id ?? 0,
                  name: current.name || user?.name || ""
                }));
              }}
            />
          </div>

          <PlayerRoleField id="role" formData={formData} setFormData={setFormData} />

          <PlayerSubRoleField
            id="sub_role"
            formData={formData}
            setFormData={setFormData}
            hasSubRoleCatalog={hasSubRoleCatalog}
            subRoleSelectOptions={subRoleSelectOptions}
          />

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="rank">Rank</Label>
              <NumberInput
                id="rank"
                integer
                min={0}
                value={formData.rank}
                onValueChange={(rank) => setFormData({ ...formData, rank: rank ?? 0 })}
              />
            </div>

            <DivisionField
              rank={formData.rank}
              grid={selectedTournament?.division_grid_version ?? null}
            />
          </div>

          <div className="space-y-2">
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
        title="Edit player"
        description="Update player details"
        onSubmit={handleSubmitUpdate}
        isSubmitting={updateMutation.isPending}
        submittingLabel="Updating player…"
        errorMessage={updateMutation.isError ? updateMutation.error.message : undefined}
        isDirty={isEditDirty}
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="edit-name">Player name</Label>
            <Input
              id="edit-name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </div>

          <PlayerRoleField id="edit-role" formData={formData} setFormData={setFormData} />

          <PlayerSubRoleField
            id="edit-sub_role"
            formData={formData}
            setFormData={setFormData}
            hasSubRoleCatalog={hasSubRoleCatalog}
            subRoleSelectOptions={subRoleSelectOptions}
          />

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="edit-rank">Rank</Label>
              <NumberInput
                id="edit-rank"
                integer
                min={0}
                value={formData.rank}
                onValueChange={(rank) => setFormData({ ...formData, rank: rank ?? 0 })}
              />
            </div>

            <DivisionField
              rank={formData.rank}
              grid={getPlayerRowDivisionGrid(selectedPlayer?.team)}
            />
          </div>

          <div className="space-y-2">
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
          title="Delete player"
          description={`Deleting “${selectedPlayer?.name}” removes the player from their roster along with their match statistics. This cannot be undone.`}
          isDeleting={deleteMutation.isPending}
        />
      ) : null}
    </div>
  );
}
