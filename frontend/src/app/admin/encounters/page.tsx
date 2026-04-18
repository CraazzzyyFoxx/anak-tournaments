"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ColumnDef } from "@tanstack/react-table";
import { Plus, Pencil, Trash2, CheckCircle, Clock, AlertCircle, FileCheck2, FileX2 } from "lucide-react";
import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatusIcon } from "@/components/admin/StatusIcon";
import { EntityFormDialog } from "@/components/admin/EntityFormDialog";
import { DeleteConfirmDialog } from "@/components/admin/DeleteConfirmDialog";
import { EncounterScoreControls } from "@/components/admin/EncounterScoreControls";
import { isGroupStageScoreContext } from "@/components/admin/encounter-score";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import encounterService from "@/services/encounter.service";
import tournamentService from "@/services/tournament.service";
import teamService from "@/services/team.service";
import adminService from "@/services/admin.service";
import { Encounter } from "@/types/encounter.types";
import { EncounterCreateInput, EncounterUpdateInput } from "@/types/admin.types";
import { StageItem } from "@/types/tournament.types";
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
import { useWorkspaceStore } from "@/stores/workspace.store";

const ENCOUNTER_STATUS_OPTIONS = ["OPEN", "PENDING", "COMPLETED"] as const;

function normalizeEncounterStatus(status?: string | null): string {
  const normalizedStatus = status?.toUpperCase();
  return ENCOUNTER_STATUS_OPTIONS.includes(normalizedStatus as (typeof ENCOUNTER_STATUS_OPTIONS)[number])
    ? normalizedStatus!
    : "OPEN";
}

function formatEncounterStatus(status?: string | null) {
  const normalizedStatus = normalizeEncounterStatus(status);
  return normalizedStatus.charAt(0) + normalizedStatus.slice(1).toLowerCase();
}

const emptyEncounterForm: EncounterCreateInput = {
  name: "",
  tournament_id: 0,
  stage_id: null,
  stage_item_id: null,
  home_team_id: 0,
  away_team_id: 0,
  round: 1,
  home_score: 0,
  away_score: 0,
  status: "OPEN",
};

function getCreateEncounterForm(
  tournamentId: number | null,
  defaultStageId: number | null,
  defaultStageItemId: number | null,
): EncounterCreateInput {
  return {
    ...emptyEncounterForm,
    tournament_id: tournamentId || 0,
    stage_id: defaultStageId,
    stage_item_id: defaultStageItemId,
  };
}

function getEditEncounterForm(encounter: Encounter): EncounterUpdateInput {
  return {
    name: encounter.name,
    stage_id: encounter.stage_id,
    stage_item_id: encounter.stage_item_id,
    home_score: encounter.score.home,
    away_score: encounter.score.away,
    status: normalizeEncounterStatus(encounter.status),
    round: encounter.round,
  };
}

function getEncounterStageLabel(encounter: Encounter): string {
  return encounter.stage_item?.name ?? encounter.stage?.name ?? "—";
}

export default function EncountersPage() {
  const router = useRouter();
  const { toast } = useToast();
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
  const [selectedTournamentId, setSelectedTournamentId] = useState<number | null>(null);

  // Fetch tournaments and teams
  const { data: tournamentsData } = useQuery({
    queryKey: ["tournaments"],
    queryFn: () => tournamentService.getAll(null)
  });

  const { data: teamsData } = useQuery({
    queryKey: ["teams", selectedTournamentId],
    queryFn: () => teamService.getAll(selectedTournamentId),
  });

  const { data: stagesData = [] } = useQuery({
    queryKey: ["admin", "stages", selectedTournamentId],
    queryFn: () => adminService.getStages(selectedTournamentId!),
    enabled: selectedTournamentId != null,
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

  const createFormInitial = getCreateEncounterForm(
    selectedTournamentId,
    defaultStageId,
    defaultStageItemId,
  );
  const editFormInitial = selectedEncounter ? getEditEncounterForm(selectedEncounter) : createFormInitial;
  const isCreateDirty = createDialogOpen && hasUnsavedChanges(formData, createFormInitial);
  const isEditDirty = editDialogOpen && hasUnsavedChanges(formData, editFormInitial);
  const selectedFormStage = stagesData.find((stage) => stage.id === formData.stage_id) ?? null;
  const selectedFormStageItem =
    selectedFormStage?.items.find((item) => item.id === formData.stage_item_id) ?? null;
  const isGroupStageForm = isGroupStageScoreContext(selectedFormStage, selectedFormStageItem);

  const getStatusIcon = (status: string) => {
    switch (normalizeEncounterStatus(status)) {
      case "COMPLETED":
        return <CheckCircle className="h-3 w-3" />;
      case "PENDING":
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
      accessorKey: "stage",
      header: "Stage",
      enableSorting: false,
      cell: ({ row }) => <div className="text-sm">{getEncounterStageLabel(row.original)}</div>
    },
    {
      accessorKey: "round",
      header: "Round",
      cell: ({ row }) => <div>Round {row.getValue("round")}</div>
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
          <div className="text-sm text-muted-foreground">{(closeness * 100).toFixed(0)}%</div>
        ) : (
          "—"
        );
      }
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => {
        const status = normalizeEncounterStatus(row.getValue<string>("status"));

        if (status === "COMPLETED") return <StatusIcon icon={CheckCircle} label="Completed" variant="success" />;
        if (status === "PENDING") return <StatusIcon icon={Clock} label="Pending" variant="warning" />;
        return <StatusIcon icon={AlertCircle} label={formatEncounterStatus(status)} variant="muted" />;
      }
    },
    {
      accessorKey: "has_logs",
      header: "Logs",
      cell: ({ row }) => {
        const hasLogs = row.getValue<boolean>("has_logs");
        return hasLogs ? (
          <StatusIcon icon={FileCheck2} label="Logs available" variant="success" />
        ) : (
          <StatusIcon icon={FileX2} label="No logs" variant="muted" />
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
            <Button onClick={handleCreate} disabled={!selectedTournamentId || stagesData.length === 0}>
              <Plus className="mr-2 h-4 w-4" />
              Create Encounter
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
        queryKey={(page, search, pageSize, sortField, sortDir) => ["encounters", selectedTournamentId, page, search, pageSize, sortField, sortDir]}
        queryFn={async (page, search, pageSize, sortField, sortDir) => {
          return encounterService.getAll(page, search, selectedTournamentId, pageSize, sortField, sortDir);
        }}
        columns={columns}
        searchPlaceholder="Search encounters..."
        emptyMessage="No encounters found."
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
            <Label htmlFor="stage_id">Stage *</Label>
            <Select
              value={(formData as EncounterCreateInput).stage_id?.toString() ?? ""}
              onValueChange={(value) => {
                const stage = stagesData.find((entry) => entry.id === Number(value)) ?? null;
                setFormData({
                  ...formData,
                  stage_id: stage?.id ?? null,
                  stage_item_id: stage?.items[0]?.id ?? null,
                });
              }}
            >
              <SelectTrigger>
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
            <Label htmlFor="stage_item_id">Stage Item</Label>
            <Select
              value={(formData as EncounterCreateInput).stage_item_id?.toString() ?? "none"}
              onValueChange={(value) =>
                setFormData((current) => {
                  const nextStageItemId = value === "none" ? null : Number(value);
                  const nextStageId =
                    nextStageItemId != null
                      ? stageItemsById.get(nextStageItemId)?.stage_id ?? current.stage_id ?? null
                      : current.stage_id ?? null;
                  return {
                    ...current,
                    stage_id: nextStageId,
                    stage_item_id: nextStageItemId,
                  };
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select stage item" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No stage item</SelectItem>
                {stagesData
                  .filter((stage) => stage.id === (formData as EncounterCreateInput).stage_id)
                  .flatMap((stage) => stage.items)
                  .map((item) => (
                    <SelectItem key={item.id} value={item.id.toString()}>
                      {item.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
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

          <EncounterScoreControls
            idPrefix="encounter-create"
            homeScore={(formData as EncounterCreateInput).home_score ?? 0}
            awayScore={(formData as EncounterCreateInput).away_score ?? 0}
            presetLabel={isGroupStageForm ? "Group stage presets" : "Result presets"}
            showGroupStageHint={isGroupStageForm}
            onScoreChange={(score) =>
              setFormData({
                ...formData,
                home_score: score.homeScore,
                away_score: score.awayScore,
              })
            }
            onPresetSelect={(score) =>
              setFormData({
                ...formData,
                home_score: score.homeScore,
                away_score: score.awayScore,
                status: "COMPLETED",
              })
            }
          />

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
                <SelectItem value="OPEN">Open</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="COMPLETED">Completed</SelectItem>
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
            <Label htmlFor="edit-stage_id">Stage *</Label>
            <Select
              value={(formData as EncounterUpdateInput).stage_id?.toString() ?? ""}
              onValueChange={(value) => {
                const stage = stagesData.find((entry) => entry.id === Number(value)) ?? null;
                setFormData({
                  ...formData,
                  stage_id: stage?.id ?? null,
                  stage_item_id: stage?.items[0]?.id ?? null,
                });
              }}
            >
              <SelectTrigger>
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
            <Label htmlFor="edit-stage_item_id">Stage Item</Label>
            <Select
              value={(formData as EncounterUpdateInput).stage_item_id?.toString() ?? "none"}
              onValueChange={(value) =>
                setFormData((current) => {
                  const nextStageItemId = value === "none" ? null : Number(value);
                  const nextStageId =
                    nextStageItemId != null
                      ? stageItemsById.get(nextStageItemId)?.stage_id ?? current.stage_id ?? null
                      : current.stage_id ?? null;
                  return {
                    ...current,
                    stage_id: nextStageId,
                    stage_item_id: nextStageItemId,
                  };
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select stage item" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No stage item</SelectItem>
                {stagesData
                  .filter((stage) => stage.id === (formData as EncounterUpdateInput).stage_id)
                  .flatMap((stage) => stage.items)
                  .map((item) => (
                    <SelectItem key={item.id} value={item.id.toString()}>
                      {item.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
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

          <EncounterScoreControls
            idPrefix="encounter-edit"
            homeScore={(formData as EncounterUpdateInput).home_score ?? 0}
            awayScore={(formData as EncounterUpdateInput).away_score ?? 0}
            presetLabel={isGroupStageForm ? "Group stage presets" : "Result presets"}
            showGroupStageHint={isGroupStageForm}
            onScoreChange={(score) =>
              setFormData({
                ...formData,
                home_score: score.homeScore,
                away_score: score.awayScore,
              })
            }
            onPresetSelect={(score) =>
              setFormData({
                ...formData,
                home_score: score.homeScore,
                away_score: score.awayScore,
                status: "COMPLETED",
              })
            }
          />

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
                <SelectItem value="OPEN">Open</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="COMPLETED">Completed</SelectItem>
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
