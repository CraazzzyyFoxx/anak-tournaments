"use client";

import { useId, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ColumnDef } from "@tanstack/react-table";
import {
  Plus,
  CheckCircle,
  Clock,
  AlertCircle,
  Star,
  FileCheck2,
  FileX2
} from "lucide-react";
import { adminColumnMeta } from "@/components/admin/admin-table-columns";
import { AdminDataTable } from "@/components/admin/AdminDataTable";
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
import { EncounterScoreControls } from "@/components/tournaments/EncounterScoreControls";
import { TeamCombobox } from "@/components/admin/TeamCombobox";
import { buildEncounterName } from "@/components/admin/encounter-name";
import { isGroupStageScoreContext, EncounterScore } from "@/components/admin/encounter-score";
import { Button } from "@/components/ui/button";
import { notify } from "@/lib/notify";
import encounterService from "@/services/encounter.service";
import tournamentService from "@/services/tournament.service";
import teamService from "@/services/team.service";
import adminService from "@/services/admin.service";
import { Encounter } from "@/types/encounter.types";
import { EncounterCreateInput, EncounterEditableStatus, EncounterUpdateInput } from "@/types/admin.types";
import { Stage, StageItem } from "@/types/tournament.types";
import { Team } from "@/types/team.types";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
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
import { useWorkspaceStore } from "@/stores/workspace.store";

// Editable statuses only. COMPLETED is set by the result endpoint, which moves
// score, status, result_status and the audit row together.
const ENCOUNTER_STATUS_OPTIONS = ["OPEN", "PENDING"] as const;

/** What the table shows — the encounter's real status, COMPLETED included. */
function displayEncounterStatus(status?: string | null): string {
  return status?.toUpperCase() ?? "OPEN";
}

/** What a form may submit. COMPLETED is not editable: it belongs to the result
 * endpoint, which moves score, status, result_status and the audit row together. */
function normalizeEncounterStatus(status?: string | null): EncounterEditableStatus {
  const normalizedStatus = status?.toUpperCase();
  return ENCOUNTER_STATUS_OPTIONS.includes(
    normalizedStatus as (typeof ENCOUNTER_STATUS_OPTIONS)[number]
  )
    ? (normalizedStatus as EncounterEditableStatus)
    : "OPEN";
}

function formatEncounterStatus(status?: string | null) {
  const shown = displayEncounterStatus(status);
  return shown.charAt(0) + shown.slice(1).toLowerCase();
}

function closenessFloatToStars(closeness: number | null | undefined): number {
  if (closeness == null || closeness <= 0) return 0;
  return Math.max(1, Math.min(5, Math.round(closeness * 5)));
}

function starsToCloseness(stars: number): number | null {
  return stars > 0 ? stars / 5 : null;
}

function getEncounterTeamsError(data: Pick<EncounterCreateInput, "home_team_id" | "away_team_id">) {
  if (
    data.home_team_id != null &&
    data.away_team_id != null &&
    data.home_team_id === data.away_team_id
  ) {
    return "Pick two different teams.";
  }

  return null;
}

const emptyEncounterForm: EncounterCreateInput = {
  name: "",
  tournament_id: 0,
  stage_id: null,
  stage_item_id: null,
  home_team_id: null,
  away_team_id: null,
  round: 1,
  home_score: 0,
  away_score: 0,
  status: "OPEN"
};

function getCreateEncounterForm(
  tournamentId: number | null,
  defaultStageId: number | null,
  defaultStageItemId: number | null
): EncounterCreateInput {
  return {
    ...emptyEncounterForm,
    tournament_id: tournamentId || 0,
    stage_id: defaultStageId,
    stage_item_id: defaultStageItemId
  };
}

function getEditEncounterForm(encounter: Encounter): EncounterUpdateInput {
  return {
    name: encounter.name,
    stage_id: encounter.stage_id,
    stage_item_id: encounter.stage_item_id,
    home_team_id: encounter.home_team_id,
    away_team_id: encounter.away_team_id,
    home_score: encounter.score.home,
    away_score: encounter.score.away,
    status: normalizeEncounterStatus(encounter.status),
    round: encounter.round,
    closeness: encounter.closeness
  };
}

function getEncounterStageLabel(encounter: Encounter): string {
  return encounter.stage_item?.name ?? encounter.stage?.name ?? "—";
}

/** Shared update logic for the create/edit dialogs' stage select — picking a stage
 * resets the stage item to that stage's first item. */
function updateEncounterStageSelection(
  current: EncounterCreateInput | EncounterUpdateInput,
  stage: Stage | null
) {
  return {
    ...current,
    stage_id: stage?.id ?? null,
    stage_item_id: stage?.items[0]?.id ?? null
  };
}

/** Shared update logic for the create/edit dialogs' stage item select — keeps stage_id
 * in sync with whichever stage the picked item actually belongs to. */
function updateEncounterStageItemSelection(
  current: EncounterCreateInput | EncounterUpdateInput,
  stageItemsById: Map<number, StageItem>,
  value: string
) {
  const nextStageItemId = value === "none" ? null : Number(value);
  const nextStageId =
    nextStageItemId != null
      ? (stageItemsById.get(nextStageItemId)?.stage_id ?? current.stage_id ?? null)
      : (current.stage_id ?? null);
  return {
    ...current,
    stage_id: nextStageId,
    stage_item_id: nextStageItemId
  };
}

/** Shared update logic for the create/edit dialogs' home/away team pickers — keeps the
 * derived encounter name in sync with whichever side changed. */
function updateEncounterTeamSelection(
  current: EncounterCreateInput | EncounterUpdateInput,
  teams: Team[],
  side: "home" | "away",
  teamId: number | null
) {
  if (side === "home") {
    return {
      ...current,
      name: buildEncounterName(teams, teamId, current.away_team_id),
      home_team_id: teamId
    };
  }
  return {
    ...current,
    name: buildEncounterName(teams, current.home_team_id, teamId),
    away_team_id: teamId
  };
}

/** The stage + stage item selects, identical between the create and edit dialogs
 * apart from the id prefix and which half of the form union owns the value. */
function EncounterStageFields({
  idPrefix,
  stagesData,
  stageId,
  stageItemId,
  onStageChange,
  onStageItemChange
}: Readonly<{
  idPrefix: string;
  stagesData: Stage[];
  stageId: number | null | undefined;
  stageItemId: number | null | undefined;
  onStageChange: (stage: Stage | null) => void;
  onStageItemChange: (value: string) => void;
}>) {
  return (
    <>
      <div>
        <Label htmlFor={`${idPrefix}stage_id`}>Stage *</Label>
        <Select
          value={stageId?.toString() ?? ""}
          onValueChange={(value) => {
            const stage = stagesData.find((entry) => entry.id === Number(value)) ?? null;
            onStageChange(stage);
          }}
        >
          <SelectTrigger id={`${idPrefix}stage_id`}>
            <SelectValue placeholder="Select stage" />
          </SelectTrigger>
          <SelectContent>
            {stagesData.map((stage) => (
              <SelectItem key={stage.id} value={stage.id.toString()}>
                {stage.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor={`${idPrefix}stage_item_id`}>Stage item</Label>
        <Select value={stageItemId?.toString() ?? "none"} onValueChange={onStageItemChange}>
          <SelectTrigger id={`${idPrefix}stage_item_id`}>
            <SelectValue placeholder="Select stage item" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No stage item</SelectItem>
            {stagesData
              .filter((stage) => stage.id === stageId)
              .flatMap((stage) => stage.items)
              .map((item) => (
                <SelectItem key={item.id} value={item.id.toString()}>
                  {item.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>
    </>
  );
}

/** A single home/away team picker, identical between the create and edit dialogs
 * apart from the id and which side of the matchup it edits. */
function EncounterTeamField({
  id,
  label,
  teams,
  value,
  onSelect
}: Readonly<{
  id: string;
  label: string;
  teams: Team[];
  value: number | null | undefined;
  onSelect: (teamId: number | null) => void;
}>) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <TeamCombobox
        id={id}
        teams={teams}
        value={value}
        placeholder={`Select ${label.toLowerCase()}`}
        onSelect={(team) => onSelect(team?.id ?? null)}
      />
    </div>
  );
}

/** The score controls block, identical between the create and edit dialogs apart
 * from the id prefix and which half of the form union owns the score. */
function EncounterScoreFieldsSection({
  idPrefix,
  homeScore,
  awayScore,
  isGroupStageForm,
  onChange
}: Readonly<{
  idPrefix: string;
  homeScore: number;
  awayScore: number;
  isGroupStageForm: boolean;
  onChange: (score: EncounterScore) => void;
}>) {
  return (
    <EncounterScoreControls
      idPrefix={idPrefix}
      homeScore={homeScore}
      awayScore={awayScore}
      presetLabel={isGroupStageForm ? "Group stage presets" : "Result presets"}
      showGroupStageHint={isGroupStageForm}
      onScoreChange={onChange}
      onPresetSelect={onChange}
    />
  );
}

export default function EncountersPage() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { canAccessPermission } = usePermissions();
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const queryClient = useQueryClient();
  const canCreate = canAccessPermission("match.create", workspaceId);
  const canUpdate = canAccessPermission("match.update", workspaceId);
  const canDelete = canAccessPermission("match.delete", workspaceId);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedEncounter, setSelectedEncounter] = useState<Encounter | null>(null);
  const selectedTournamentId = parseTournamentQueryParam(searchParams.get(TOURNAMENT_QUERY_PARAM));
  const formTournamentId =
    editDialogOpen && selectedEncounter ? selectedEncounter.tournament_id : selectedTournamentId;
  const createHintId = useId();

  // Fetch tournaments and teams
  const { data: tournamentsData } = useQuery({
    queryKey: ["tournaments"],
    queryFn: () => tournamentService.getAll(null)
  });

  const { data: teamsData } = useQuery({
    queryKey: ["teams", formTournamentId],
    queryFn: () => teamService.getAll({ tournamentId: formTournamentId })
  });

  const { data: stagesData = [] } = useQuery({
    queryKey: ["admin", "stages", formTournamentId],
    queryFn: () => adminService.getStages(formTournamentId!),
    enabled: formTournamentId != null
  });

  const defaultStage = stagesData[0] ?? null;
  const defaultStageItem = defaultStage?.items[0] ?? null;
  const defaultStageId = defaultStage?.id ?? null;
  const defaultStageItemId = defaultStageItem?.id ?? null;
  const stageItemsById = new Map<number, StageItem>();
  for (const stage of stagesData) {
    for (const item of stage.items) {
      stageItemsById.set(item.id, item);
    }
  }

  // Form state
  const [formData, setFormData] = useState<EncounterCreateInput | EncounterUpdateInput>({
    ...emptyEncounterForm
  });

  // Mutations
  const createMutation = useMutation({
    meta: { suppressErrorToast: true },
    mutationFn: (data: EncounterCreateInput) => adminService.createEncounter(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["encounters"] });
      setCreateDialogOpen(false);
      resetForm();
      notify.success("Encounter created successfully");
    }
  });

  const updateMutation = useMutation({
    meta: { suppressErrorToast: true },
    mutationFn: ({ id, data }: { id: number; data: EncounterUpdateInput }) =>
      adminService.updateEncounter(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["encounters"] });
      setEditDialogOpen(false);
      setSelectedEncounter(null);
      resetForm();
      notify.success("Encounter updated successfully");
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => adminService.deleteEncounter(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["encounters"] });
      setDeleteDialogOpen(false);
      setSelectedEncounter(null);
      notify.success("Encounter deleted successfully");
    }
  });

  const resetForm = () => {
    setFormData(getCreateEncounterForm(selectedTournamentId, defaultStageId, defaultStageItemId));
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
    const teamsError = getEncounterTeamsError(formData as EncounterCreateInput);
    if (teamsError) {
      notify.error("Can't create the encounter", { description: teamsError });
      return;
    }
    createMutation.mutate(formData as EncounterCreateInput);
  };

  const handleSubmitUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedEncounter) {
      const teamsError = getEncounterTeamsError({
        home_team_id: (formData as EncounterUpdateInput).home_team_id ?? null,
        away_team_id: (formData as EncounterUpdateInput).away_team_id ?? null
      });
      if (teamsError) {
        notify.error("Can't update the encounter", { description: teamsError });
        return;
      }
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

  const handleTournamentFilterChange = (value: string) => {
    const query = nextTournamentFilterQuery(searchParams.toString(), TOURNAMENT_QUERY_PARAM, value);
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const createFormInitial = getCreateEncounterForm(
    selectedTournamentId,
    defaultStageId,
    defaultStageItemId
  );
  const editFormInitial = selectedEncounter
    ? getEditEncounterForm(selectedEncounter)
    : createFormInitial;
  const isCreateDirty = createDialogOpen && hasUnsavedChanges(formData, createFormInitial);
  const isEditDirty = editDialogOpen && hasUnsavedChanges(formData, editFormInitial);
  const editClosenessStars = closenessFloatToStars((formData as EncounterUpdateInput).closeness);
  const selectedFormStage = stagesData.find((stage) => stage.id === formData.stage_id) ?? null;
  const selectedFormStageItem =
    selectedFormStage?.items.find((item) => item.id === formData.stage_item_id) ?? null;
  const isGroupStageForm = isGroupStageScoreContext(selectedFormStage, selectedFormStageItem);
  const createBlockedReason =
    selectedTournamentId == null
      ? "Pick a tournament first — an encounter belongs to one tournament."
      : stagesData.length === 0
        ? "This tournament has no stages yet. Add a stage before creating encounters."
        : null;

  const columns: ColumnDef<Encounter>[] = [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => <div className="font-medium">{row.getValue("name")}</div>
    },
    {
      id: "teams",
      header: "Teams",
      enableSorting: false,
      cell: ({ row }) => {
        const { home_team, away_team } = row.original;
        return (
          <div className="flex items-center gap-1 text-sm">
            <span className="font-medium">{home_team?.name ?? "TBD"}</span>
            <span className="text-muted-foreground">vs</span>
            <span className="font-medium">{away_team?.name ?? "TBD"}</span>
          </div>
        );
      }
    },
    {
      accessorKey: "stage",
      header: "Stage",
      enableSorting: false,
      cell: ({ row }) => <div className="text-sm">{getEncounterStageLabel(row.original)}</div>
    },
    {
      accessorKey: "round",
      header: "Round",
      cell: ({ row }) => <div className="tabular-nums">Round {row.getValue("round")}</div>
    },
    {
      accessorKey: "score",
      header: "Score",
      enableSorting: false,
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
          <div className="text-sm tabular-nums text-muted-foreground">
            {(closeness * 100).toFixed(0)}%
          </div>
        ) : (
          "—"
        );
      }
    },
    {
      accessorKey: "status",
      header: "Status",
      meta: adminColumnMeta<Encounter>({
        filter: {
          param: "status",
          label: "Filter by status",
          options: [
            { value: "OPEN", label: "Open" },
            { value: "PENDING", label: "Pending" },
            { value: "COMPLETED", label: "Completed" }
          ]
        }
      }),
      cell: ({ row }) => {
        const status = displayEncounterStatus(row.getValue<string>("status"));

        if (status === "COMPLETED")
          return <StatusIcon icon={CheckCircle} label="Completed" variant="success" />;
        if (status === "PENDING")
          return <StatusIcon icon={Clock} label="Pending" variant="warning" />;
        return (
          <StatusIcon icon={AlertCircle} label={formatEncounterStatus(status)} variant="muted" />
        );
      }
    },
    {
      accessorKey: "has_logs",
      header: "Logs",
      meta: adminColumnMeta<Encounter>({
        filter: {
          param: "has_logs",
          label: "Filter by logs",
          options: [
            { value: "true", label: "Logs available" },
            { value: "false", label: "No logs" }
          ]
        }
      }),
      cell: ({ row }) => {
        const hasLogs = row.getValue<boolean>("has_logs");
        return hasLogs ? (
          <StatusIcon icon={FileCheck2} label="Logs available" variant="success" />
        ) : (
          <StatusIcon icon={FileX2} label="No logs" variant="muted" />
        );
      }
    },
    createRowActionsColumn<Encounter>({
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
        title="Encounters"
        description="Manage tournament encounters and matches"
        actions={
          canCreate ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {createBlockedReason ? (
                <span id={createHintId} className="text-sm text-muted-foreground">
                  {createBlockedReason}
                </span>
              ) : null}
              <Button
                onClick={handleCreate}
                disabled={createBlockedReason != null}
                aria-describedby={createBlockedReason ? createHintId : undefined}
              >
                <Plus className="mr-2 h-4 w-4" aria-hidden />
                Create encounter
              </Button>
            </div>
          ) : null
        }
      />

      <AdminDataTable
        queryKey={(page, search, pageSize, sortField, sortDir, filters) => [
          "encounters",
          selectedTournamentId,
          page,
          search,
          pageSize,
          sortField,
          sortDir,
          filters
        ]}
        queryFn={async (page, search, pageSize, sortField, sortDir, filters) => {
          return encounterService.getAll(
            page,
            search,
            selectedTournamentId,
            pageSize,
            sortField,
            sortDir,
            undefined,
            {
              status: filters.status?.[0] ?? null,
              has_logs: filters.has_logs ? filters.has_logs[0] === "true" : null
            }
          );
        }}
        columns={columns}
        searchPlaceholder="Search encounters…"
        emptyMessage={
          selectedTournamentId
            ? "No encounters yet. Use “Create encounter” to schedule the first match."
            : "No encounters yet. Pick a tournament to see its bracket."
        }
        actions={
          <TournamentFilterSelect
            tournaments={tournamentsData?.results ?? []}
            selectedTournamentId={selectedTournamentId}
            onValueChange={handleTournamentFilterChange}
          />
        }
        onRowClick={(row) => router.push(`/encounters/${row.original.id}`)}
      />

      {/* Create Dialog */}
      <EntityFormDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        title="Create encounter"
        description="Schedule a new encounter between two teams"
        onSubmit={handleSubmitCreate}
        isSubmitting={createMutation.isPending}
        submittingLabel="Creating encounter…"
        errorMessage={createMutation.isError ? createMutation.error.message : undefined}
        isDirty={isCreateDirty}
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="name">Encounter name *</Label>
            <Input
              id="name"
              value={(formData as EncounterCreateInput).name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              placeholder="e.g., Quarter Final 1"
            />
          </div>

          <EncounterStageFields
            idPrefix=""
            stagesData={stagesData}
            stageId={(formData as EncounterCreateInput).stage_id}
            stageItemId={(formData as EncounterCreateInput).stage_item_id}
            onStageChange={(stage) =>
              setFormData((current) => updateEncounterStageSelection(current, stage))
            }
            onStageItemChange={(value) =>
              setFormData((current) =>
                updateEncounterStageItemSelection(current, stageItemsById, value)
              )
            }
          />

          <EncounterTeamField
            id="home_team_id"
            label="Home team"
            teams={teamsData?.results ?? []}
            value={(formData as EncounterCreateInput).home_team_id}
            onSelect={(teamId) =>
              setFormData((current) =>
                updateEncounterTeamSelection(current, teamsData?.results ?? [], "home", teamId)
              )
            }
          />

          <EncounterTeamField
            id="away_team_id"
            label="Away team"
            teams={teamsData?.results ?? []}
            value={(formData as EncounterCreateInput).away_team_id}
            onSelect={(teamId) =>
              setFormData((current) =>
                updateEncounterTeamSelection(current, teamsData?.results ?? [], "away", teamId)
              )
            }
          />

          <div>
            <Label htmlFor="round">Round *</Label>
            <NumberInput
              id="round"
              integer
              value={(formData as EncounterCreateInput).round}
              onValueChange={(next) => setFormData({ ...formData, round: next ?? 0 })}
              required
            />
          </div>

          <EncounterScoreFieldsSection
            idPrefix="encounter-create"
            homeScore={(formData as EncounterCreateInput).home_score ?? 0}
            awayScore={(formData as EncounterCreateInput).away_score ?? 0}
            isGroupStageForm={isGroupStageForm}
            onChange={(score) =>
              setFormData({ ...formData, home_score: score.homeScore, away_score: score.awayScore })
            }
          />

          <div>
            <Label htmlFor="status">Status</Label>
            <Select
              value={(formData as EncounterCreateInput).status}
              onValueChange={(value) => setFormData({ ...formData, status: value as EncounterEditableStatus })}
            >
              <SelectTrigger id="status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="OPEN">Open</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </EntityFormDialog>

      {/* Edit Dialog */}
      <EntityFormDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        title="Edit encounter"
        description="Update encounter details"
        onSubmit={handleSubmitUpdate}
        isSubmitting={updateMutation.isPending}
        submittingLabel="Updating encounter…"
        errorMessage={updateMutation.isError ? updateMutation.error.message : undefined}
        isDirty={isEditDirty}
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="edit-name">Encounter name</Label>
            <Input
              id="edit-name"
              value={(formData as EncounterUpdateInput).name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </div>

          <EncounterStageFields
            idPrefix="edit-"
            stagesData={stagesData}
            stageId={(formData as EncounterUpdateInput).stage_id}
            stageItemId={(formData as EncounterUpdateInput).stage_item_id}
            onStageChange={(stage) =>
              setFormData((current) => updateEncounterStageSelection(current, stage))
            }
            onStageItemChange={(value) =>
              setFormData((current) =>
                updateEncounterStageItemSelection(current, stageItemsById, value)
              )
            }
          />

          <div>
            <Label htmlFor="edit-round">Round</Label>
            <NumberInput
              id="edit-round"
              integer
              value={(formData as EncounterUpdateInput).round}
              onValueChange={(next) => setFormData({ ...formData, round: next ?? 0 })}
            />
          </div>

          <EncounterTeamField
            id="edit-home_team_id"
            label="Home team"
            teams={teamsData?.results ?? []}
            value={(formData as EncounterUpdateInput).home_team_id}
            onSelect={(teamId) =>
              setFormData((current) =>
                updateEncounterTeamSelection(current, teamsData?.results ?? [], "home", teamId)
              )
            }
          />

          <EncounterTeamField
            id="edit-away_team_id"
            label="Away team"
            teams={teamsData?.results ?? []}
            value={(formData as EncounterUpdateInput).away_team_id}
            onSelect={(teamId) =>
              setFormData((current) =>
                updateEncounterTeamSelection(current, teamsData?.results ?? [], "away", teamId)
              )
            }
          />

          <EncounterScoreFieldsSection
            idPrefix="encounter-edit"
            homeScore={(formData as EncounterUpdateInput).home_score ?? 0}
            awayScore={(formData as EncounterUpdateInput).away_score ?? 0}
            isGroupStageForm={isGroupStageForm}
            onChange={(score) =>
              setFormData({ ...formData, home_score: score.homeScore, away_score: score.awayScore })
            }
          />

          <div>
            <Label htmlFor="edit-status">Status</Label>
            <Select
              value={(formData as EncounterUpdateInput).status}
              onValueChange={(value) => setFormData({ ...formData, status: value as EncounterEditableStatus })}
            >
              <SelectTrigger id="edit-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="OPEN">Open</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div role="group" aria-label="Match closeness">
            <p className="text-sm font-medium leading-none">Match closeness</p>
            <div className="mt-2 flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((stars) => (
                <button
                  key={stars}
                  type="button"
                  className="p-1"
                  aria-label={`Rate closeness ${stars} of 5`}
                  aria-pressed={stars <= editClosenessStars}
                  onClick={() =>
                    setFormData({
                      ...formData,
                      closeness: starsToCloseness(stars === editClosenessStars ? 0 : stars)
                    })
                  }
                >
                  <Star
                    aria-hidden
                    className={`h-6 w-6 ${
                      stars <= editClosenessStars
                        ? "fill-warning text-warning"
                        : "text-muted-foreground"
                    }`}
                  />
                </button>
              ))}
              <span className="ml-2 text-sm tabular-nums text-muted-foreground">
                {editClosenessStars > 0 ? `${editClosenessStars}/5` : "Not set"}
              </span>
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
          title="Delete encounter"
          description={`Deleting “${selectedEncounter?.name}” removes the encounter and every match, log and statistic recorded under it. This cannot be undone.`}
          cascadeInfo={["All matches in this encounter", "All match statistics and logs"]}
          isDeleting={deleteMutation.isPending}
        />
      ) : null}
    </div>
  );
}
