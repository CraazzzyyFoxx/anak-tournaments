"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  GitBranch,
  GitMerge,
  Link2,
  Loader2,
  Pencil,
  PlayCircle,
  Plus,
  Shield,
  Shuffle,
  Trash2,
  Wand2,
  Zap
} from "lucide-react";
import { DeleteConfirmDialog } from "@/components/admin/DeleteConfirmDialog";
import { EntityFormDialog } from "@/components/admin/EntityFormDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/hooks/usePermissions";
import adminService from "@/services/admin.service";
import teamService from "@/services/team.service";
import type {
  Stage,
  StageItem,
  StageItemInput,
  StageItemType,
  StageType
} from "@/types/tournament.types";
import type { Team } from "@/types/team.types";
import { invalidateTournamentWorkspace } from "./tournamentWorkspace.queryKeys";

const BRACKET_STAGE_TYPES: StageType[] = ["single_elimination", "double_elimination"];
const GROUP_STAGE_TYPES: StageType[] = ["round_robin", "swiss"];

const STAGE_TYPE_LABELS: Record<StageType, string> = {
  round_robin: "Round Robin",
  single_elimination: "Single Elimination",
  double_elimination: "Double Elimination",
  swiss: "Swiss"
};

const STAGE_ITEM_TYPE_LABELS: Record<StageItemType, string> = {
  group: "Group",
  bracket_upper: "Upper Bracket",
  bracket_lower: "Lower Bracket",
  single_bracket: "Single Bracket"
};

interface StageManagerProps {
  tournamentId: number;
}

interface StageItemDraft {
  name: string;
  type: StageItemType;
}

type WireDraft = {
  sourceStageId?: number;
  top: number;
  top_lb: number;
  mode: "cross" | "snake";
};

function getStageTeamSlots(stage: Stage) {
  return stage.items.reduce((acc, item) => acc + item.inputs.length, 0);
}

function getStageAssignedTeams(stage: Stage) {
  return stage.items.reduce(
    (acc, item) => acc + item.inputs.filter((input) => input.team_id != null).length,
    0
  );
}

function getDefaultStageItemType(stageType: StageType): StageItemType {
  if (stageType === "single_elimination") return "single_bracket";
  if (stageType === "double_elimination") return "bracket_upper";
  return "group";
}

function getNextInputSlot(item: StageItem) {
  return item.inputs.reduce((max, input) => Math.max(max, input.slot), 0) + 1;
}

function getAssignedTeamIds(stage: Stage) {
  return new Set(
    stage.items.flatMap((item) =>
      item.inputs.map((input) => input.team_id).filter((teamId): teamId is number => teamId != null)
    )
  );
}

function getTeamName(teamById: Map<number, Team>, teamId: number | null) {
  if (teamId == null) return "Empty slot";
  return teamById.get(teamId)?.name ?? `Team #${teamId}`;
}

function normalizeMaxRounds(value: string | number, fallback = 5) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
}

function getProgressPercent(completed: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((completed / total) * 100);
}

function getStageStatus(stage: Stage) {
  if (stage.is_completed) return "Completed";
  if (stage.is_active) return "Active";
  return "Draft";
}

function getStageStatusClass(stage: Stage) {
  if (stage.is_completed) return "border-emerald-700/60 bg-emerald-950/20 text-emerald-300";
  if (stage.is_active) return "border-primary/50 bg-primary/15 text-primary";
  return "border-border/70 bg-muted/30 text-muted-foreground";
}

function getInputDisplayLabel(
  input: StageItemInput,
  stages: Stage[],
  teamById: Map<number, Team>
) {
  if (input.team_id != null) {
    return getTeamName(teamById, input.team_id);
  }

  if (
    input.input_type === "tentative" &&
    input.source_stage_item_id != null &&
    input.source_position != null
  ) {
    const sourceItem = stages
      .flatMap((stage) => stage.items)
      .find((item) => item.id === input.source_stage_item_id);
    const groupName = sourceItem?.name ?? `Item ${input.source_stage_item_id}`;
    return `Winner of ${groupName} #${input.source_position}`;
  }

  return "Empty slot";
}

function isMergeableGroupStage(stage: Stage) {
  return (
    GROUP_STAGE_TYPES.includes(stage.stage_type) &&
    stage.items.length > 0 &&
    stage.items.every((item) => item.type === "group")
  );
}

function getDefaultMergedStageName(stage: Stage) {
  const stageName = stage.name.trim();
  const itemNames = new Set(stage.items.map((item) => item.name.trim().toLowerCase()));
  if (!stageName || itemNames.has(stageName.toLowerCase()) || /^[a-z]$/i.test(stageName)) {
    return "Groups";
  }
  return stageName;
}

export function StageManager({ tournamentId }: StageManagerProps) {
  const queryClient = useQueryClient();
  const { isSuperuser } = usePermissions();
  const [selectedStageId, setSelectedStageId] = useState<number | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [stageToDelete, setStageToDelete] = useState<Stage | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [newStageName, setNewStageName] = useState("");
  const [newStageType, setNewStageType] = useState<StageType>("round_robin");
  const [newStageMaxRounds, setNewStageMaxRounds] = useState("5");
  const [newStageDeGrandFinalType, setNewStageDeGrandFinalType] = useState<
    "no_reset" | "with_reset"
  >("no_reset");
  const [stageTypeDrafts, setStageTypeDrafts] = useState<Record<number, StageType>>({});
  const [stageMaxRoundDrafts, setStageMaxRoundDrafts] = useState<Record<number, string>>({});
  const [stageDeGfTypeDrafts, setStageDeGfTypeDrafts] = useState<
    Record<number, "no_reset" | "with_reset">
  >({});
  const [stageItemDrafts, setStageItemDrafts] = useState<Record<number, StageItemDraft>>({});
  const [teamDrafts, setTeamDrafts] = useState<Record<number, string>>({});
  const [editingItemTypeId, setEditingItemTypeId] = useState<number | null>(null);
  const [editingInputId, setEditingInputId] = useState<number | null>(null);
  const [editingInputTeamDraft, setEditingInputTeamDraft] = useState("");
  const [wireDrafts, setWireDrafts] = useState<Record<number, WireDraft>>({});

  const { data: stages = [], isLoading } = useQuery({
    queryKey: ["admin", "stages", tournamentId],
    queryFn: () => adminService.getStages(tournamentId)
  });

  const { data: teamsData, isLoading: isTeamsLoading } = useQuery({
    queryKey: ["admin", "tournament", "teams", tournamentId],
    queryFn: () => teamService.getAll(tournamentId, "name", "asc")
  });

  const { data: stageProgress = [] } = useQuery({
    queryKey: ["admin", "stages", tournamentId, "progress"],
    queryFn: () => adminService.getStagesProgress(tournamentId),
    enabled: stages.length > 0
  });

  const orderedStages = useMemo(
    () => [...stages].sort((left, right) => left.order - right.order),
    [stages]
  );
  const teams = teamsData?.results ?? [];
  const teamById = new Map(teams.map((team) => [team.id, team]));
  const progressByStageId = new Map(stageProgress.map((progress) => [progress.stage_id, progress]));
  const preferredStageId =
    orderedStages.find((stage) => stage.is_active)?.id ?? orderedStages[0]?.id ?? null;
  const effectiveSelectedStageId = orderedStages.some((stage) => stage.id === selectedStageId)
    ? selectedStageId
    : preferredStageId;
  const selectedStage =
    orderedStages.find((stage) => stage.id === effectiveSelectedStageId) ?? null;

  const invalidateStageData = () => {
    void invalidateTournamentWorkspace(queryClient, tournamentId);
  };

  const resetCreateStageForm = () => {
    setNewStageName("");
    setNewStageType("round_robin");
    setNewStageMaxRounds("5");
    setNewStageDeGrandFinalType("no_reset");
  };

  const createMutation = useMutation({
    mutationFn: () =>
      adminService.createStage(tournamentId, {
        name: newStageName.trim(),
        stage_type: newStageType,
        max_rounds: normalizeMaxRounds(newStageMaxRounds),
        order: stages.length,
        settings_json:
          newStageType === "double_elimination"
            ? { de_grand_final_type: newStageDeGrandFinalType }
            : null
      }),
    onSuccess: (stage) => {
      invalidateStageData();
      setSelectedStageId(stage.id);
      setCreateDialogOpen(false);
      resetCreateStageForm();
    }
  });

  const updateStageMutation = useMutation({
    mutationFn: ({
      stageId,
      data
    }: {
      stageId: number;
      data: {
        stage_type?: StageType;
        max_rounds?: number;
        settings_json?: Record<string, unknown> | null;
      };
    }) => adminService.updateStage(stageId, data),
    onSuccess: (_stage, variables) => {
      setStageTypeDrafts((current) => {
        const next = { ...current };
        delete next[variables.stageId];
        return next;
      });
      setStageMaxRoundDrafts((current) => {
        const next = { ...current };
        delete next[variables.stageId];
        return next;
      });
      setStageDeGfTypeDrafts((current) => {
        const next = { ...current };
        delete next[variables.stageId];
        return next;
      });
      invalidateStageData();
    }
  });

  const activateMutation = useMutation({
    mutationFn: (stageId: number) => adminService.activateStage(stageId),
    onSuccess: () => {
      invalidateStageData();
    }
  });

  const generateMutation = useMutation({
    mutationFn: (stageId: number) => adminService.generateBracket(stageId),
    onSuccess: () => {
      invalidateStageData();
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (stageId: number) => adminService.deleteStage(stageId),
    onSuccess: () => {
      setStageToDelete(null);
      setSelectedStageId(null);
      invalidateStageData();
    }
  });

  const mergeGroupStagesMutation = useMutation({
    mutationFn: ({
      targetStageId,
      sourceStageIds,
      targetName
    }: {
      targetStageId: number;
      sourceStageIds: number[];
      targetName: string;
    }) =>
      adminService.mergeGroupStages(targetStageId, {
        source_stage_ids: sourceStageIds,
        target_name: targetName
      }),
    onSuccess: (stage) => {
      setSelectedStageId(stage.id);
      invalidateStageData();
    }
  });

  const createItemMutation = useMutation({
    mutationFn: ({
      stageId,
      name,
      type,
      order
    }: {
      stageId: number;
      name: string;
      type: StageItemType;
      order: number;
    }) => adminService.createStageItem(stageId, { name, type, order }),
    onSuccess: (_item, variables) => {
      setStageItemDrafts((current) => {
        const next = { ...current };
        delete next[variables.stageId];
        return next;
      });
      invalidateStageData();
    }
  });

  const updateItemTypeMutation = useMutation({
    mutationFn: ({ stageItemId, type }: { stageItemId: number; type: StageItemType }) =>
      adminService.updateStageItem(stageItemId, { type }),
    onSuccess: () => {
      setEditingItemTypeId(null);
      invalidateStageData();
    }
  });

  const updateInputMutation = useMutation({
    mutationFn: ({ inputId, teamId }: { inputId: number; teamId: number }) =>
      adminService.updateStageItemInput(inputId, { team_id: teamId, input_type: "final" }),
    onSuccess: () => {
      setEditingInputId(null);
      setEditingInputTeamDraft("");
      invalidateStageData();
    }
  });

  const createInputMutation = useMutation({
    mutationFn: ({
      stageItemId,
      slot,
      teamId
    }: {
      stageItemId: number;
      slot: number;
      teamId: number;
    }) =>
      adminService.createStageItemInput(stageItemId, {
        slot,
        input_type: "final",
        team_id: teamId
      }),
    onSuccess: (_input, variables) => {
      setTeamDrafts((current) => {
        const next = { ...current };
        delete next[variables.stageItemId];
        return next;
      });
      invalidateStageData();
    }
  });

  const wireFromGroupsMutation = useMutation({
    mutationFn: ({
      targetStageId,
      sourceStageId,
      top,
      top_lb,
      mode
    }: {
      targetStageId: number;
      sourceStageId: number;
      top: number;
      top_lb: number;
      mode: "cross" | "snake";
    }) =>
      adminService.wireFromGroups(targetStageId, {
        source_stage_id: sourceStageId,
        top,
        top_lb,
        mode
      }),
    onSuccess: () => {
      invalidateStageData();
    }
  });

  const activateAndGenerateMutation = useMutation({
    mutationFn: async (stageId: number) => {
      try {
        return await adminService.activateAndGenerateStage(stageId);
      } catch (error) {
        const detail = (error as { detail?: unknown })?.detail;
        if (
          typeof detail === "object" &&
          detail !== null &&
          "code" in detail &&
          (detail as { code: string }).code === "upstream_stages_not_completed"
        ) {
          const proceed = window.confirm(
            "Upstream stages still have pending encounters. Activate anyway?\n\n" +
              "Playoff seeds may freeze before groups are actually finished."
          );
          if (!proceed) {
            throw error;
          }
          return adminService.activateAndGenerateStage(stageId, { force: true });
        }
        throw error;
      }
    },
    onSuccess: () => {
      invalidateStageData();
    }
  });

  const seedTeamsMutation = useMutation({
    mutationFn: ({
      stageId,
      mode
    }: {
      stageId: number;
      mode: "snake_sr" | "by_total_sr" | "random";
    }) => {
      const teamIds = (teamsData?.results ?? []).map((team) => team.id);
      return adminService.seedTeams(stageId, { team_ids: teamIds, mode });
    },
    onSuccess: () => {
      invalidateStageData();
    }
  });

  const handleCreateStageSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!newStageName.trim()) return;
    createMutation.mutate();
  };

  const selectedStageProgress = selectedStage ? progressByStageId.get(selectedStage.id) : null;
  const selectedStageSlots = selectedStage ? getStageTeamSlots(selectedStage) : 0;
  const selectedStageAssignedTeams = selectedStage ? getStageAssignedTeams(selectedStage) : 0;
  const selectedStageAssignedTeamIds = selectedStage ? getAssignedTeamIds(selectedStage) : new Set<number>();
  const selectedStageProgressPercent = selectedStageProgress
    ? getProgressPercent(selectedStageProgress.completed, selectedStageProgress.total)
    : 0;
  const selectedStageTypeDraft = selectedStage
    ? stageTypeDrafts[selectedStage.id] ?? selectedStage.stage_type
    : "round_robin";
  const selectedStageMaxRoundDraft = selectedStage
    ? stageMaxRoundDrafts[selectedStage.id] ?? String(selectedStage.max_rounds ?? 5)
    : "5";
  const currentDeGfType =
    selectedStage && selectedStage.settings_json
      ? ((selectedStage.settings_json.de_grand_final_type as "no_reset" | "with_reset" | undefined) ??
        "no_reset")
      : "no_reset";
  const selectedStageDeGfTypeDraft = selectedStage
    ? stageDeGfTypeDrafts[selectedStage.id] ?? currentDeGfType
    : "no_reset";
  const maxRoundsDraftValue = selectedStage
    ? normalizeMaxRounds(selectedStageMaxRoundDraft, selectedStage.max_rounds ?? 5)
    : 5;
  const isStageDirty =
    Boolean(selectedStage) &&
    (selectedStageTypeDraft !== selectedStage?.stage_type ||
      maxRoundsDraftValue !== (selectedStage?.max_rounds ?? 5) ||
      (selectedStageTypeDraft === "double_elimination" &&
        selectedStageDeGfTypeDraft !== currentDeGfType));
  const selectedItemDraft = selectedStage
    ? stageItemDrafts[selectedStage.id] ?? {
        name: "",
        type: getDefaultStageItemType(selectedStage.stage_type)
      }
    : { name: "", type: "group" as StageItemType };
  const nextItemName =
    selectedItemDraft.type === "group"
      ? `Group ${(selectedStage?.items.length ?? 0) + 1}`
      : "Bracket";
  const mergeableGroupStageCandidates =
    selectedStage && isMergeableGroupStage(selectedStage)
      ? orderedStages.filter(
          (stage) =>
            stage.id !== selectedStage.id &&
            stage.stage_type === selectedStage.stage_type &&
            isMergeableGroupStage(stage)
        )
      : [];
  const mergedStageName = selectedStage ? getDefaultMergedStageName(selectedStage) : "Groups";
  const groupStages = selectedStage
    ? orderedStages.filter(
        (stage) => GROUP_STAGE_TYPES.includes(stage.stage_type) && stage.id !== selectedStage.id
      )
    : [];
  const selectedWireDraft =
    selectedStage && BRACKET_STAGE_TYPES.includes(selectedStage.stage_type) && groupStages.length > 0
      ? wireDrafts[selectedStage.id] ?? {
          sourceStageId: groupStages[0]?.id,
          top: 2,
          top_lb: 0,
          mode: "cross" as const
        }
      : null;
  const createStageDirty =
    newStageName.trim().length > 0 ||
    newStageType !== "round_robin" ||
    newStageMaxRounds !== "5" ||
    newStageDeGrandFinalType !== "no_reset";

  if (isLoading) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex items-center gap-3 py-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading stages...
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="overflow-hidden border-border/40">
        <CardHeader className="gap-3 pb-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <GitBranch className="size-4 text-primary" />
                <CardTitle className="text-base">Tournament Flow</CardTitle>
              </div>
              <CardDescription className="mt-1">
                Build the bracket path one stage at a time, then use focused actions on the
                selected stage.
              </CardDescription>
            </div>
            <Button onClick={() => setCreateDialogOpen(true)}>
              <Plus className="size-4" />
              Add Stage
            </Button>
          </div>
        </CardHeader>

        <CardContent className="pt-0">
          {orderedStages.length === 0 ? (
            <div className="flex min-h-[320px] flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border/70 bg-muted/10 p-6 text-center">
              <div className="rounded-full border border-border/70 bg-background p-3">
                <GitBranch className="size-6 text-primary" />
              </div>
              <div className="max-w-md">
                <p className="text-sm font-semibold">No stages configured</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Start by adding the first tournament phase. Groups, playoffs, and finals will
                  appear here as a readable flow.
                </p>
              </div>
              <Button onClick={() => setCreateDialogOpen(true)}>
                <Plus className="size-4" />
                Add First Stage
              </Button>
            </div>
          ) : (
            <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
              <div className="rounded-xl border border-border/60 bg-background/40">
                <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold">Flow Timeline</p>
                    <p className="text-xs text-muted-foreground">
                      {orderedStages.length} stage{orderedStages.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <Badge variant="outline">{teams.length} teams</Badge>
                </div>

                <div className="flex flex-col gap-2 p-2">
                  {orderedStages.map((stage, index) => {
                    const progress = progressByStageId.get(stage.id);
                    const stageSlots = getStageTeamSlots(stage);
                    const assignedTeams = getStageAssignedTeams(stage);
                    const progressPercent = progress
                      ? getProgressPercent(progress.completed, progress.total)
                      : 0;
                    const isSelected = effectiveSelectedStageId === stage.id;

                    return (
                      <button
                        key={stage.id}
                        type="button"
                        className={cn(
                          "group w-full rounded-lg border border-transparent p-3 text-left transition-colors hover:border-border/70 hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                          isSelected && "border-primary/50 bg-primary/10"
                        )}
                        onClick={() => setSelectedStageId(stage.id)}
                      >
                        <div className="flex items-start gap-3">
                          <span
                            className={cn(
                              "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                              isSelected
                                ? "border-primary/60 bg-primary/15 text-primary"
                                : "border-border/70 bg-background text-muted-foreground"
                            )}
                          >
                            {index + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <p className="truncate text-sm font-semibold">{stage.name}</p>
                              <Badge variant="outline" className={cn("shrink-0", getStageStatusClass(stage))}>
                                {getStageStatus(stage)}
                              </Badge>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                              <span>{STAGE_TYPE_LABELS[stage.stage_type]}</span>
                              <span>|</span>
                              <span>{stage.items.length} item(s)</span>
                              <span>|</span>
                              <span>
                                {assignedTeams}/{stageSlots} slots
                              </span>
                            </div>
                            {progress && progress.total > 0 ? (
                              <div className="mt-3">
                                <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                                  <span>Matches</span>
                                  <span>
                                    {progress.completed}/{progress.total}
                                  </span>
                                </div>
                                <Progress value={progressPercent} className="h-1.5" />
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {selectedStage ? (
                <div className="min-w-0 rounded-xl border border-border/60 bg-background/40">
                  <div className="flex flex-col gap-3 border-b border-border/60 px-4 py-4 2xl:flex-row 2xl:items-start 2xl:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-lg font-semibold">{selectedStage.name}</h3>
                        <Badge variant="outline">{STAGE_TYPE_LABELS[selectedStage.stage_type]}</Badge>
                        <Badge variant="outline" className={getStageStatusClass(selectedStage)}>
                          {getStageStatus(selectedStage)}
                        </Badge>
                        {selectedStage.challonge_slug ? (
                          <a
                            className="inline-flex items-center gap-1 rounded-full border border-primary/30 px-2 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                            href={`https://challonge.com/${selectedStage.challonge_slug}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Link2 className="size-3" />
                            Challonge
                          </a>
                        ) : null}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>{selectedStage.items.length} structure item(s)</span>
                        <span>|</span>
                        <span>
                          {selectedStageAssignedTeams}/{selectedStageSlots} team slots filled
                        </span>
                        {selectedStage.stage_type === "swiss" ? (
                          <>
                            <span>|</span>
                            <span>{selectedStage.max_rounds ?? 5} max round(s)</span>
                          </>
                        ) : null}
                        {selectedStage.stage_type === "double_elimination" ? (
                          <>
                            <span>|</span>
                            <span>
                              GF: {currentDeGfType === "with_reset" ? "With Reset" : "No Reset"}
                            </span>
                          </>
                        ) : null}
                      </div>
                      {selectedStageProgress && selectedStageProgress.total > 0 ? (
                        <div className="mt-3 max-w-md">
                          <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                            <span>Match completion</span>
                            <span>
                              {selectedStageProgress.completed}/{selectedStageProgress.total}
                            </span>
                          </div>
                          <Progress value={selectedStageProgressPercent} />
                        </div>
                      ) : null}
                    </div>

                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setStageToDelete(selectedStage)}
                    >
                      <Trash2 className="size-4" />
                      Delete Stage
                    </Button>
                  </div>

                  <div className="flex flex-col gap-4 p-4">
                    <section className="rounded-lg border border-border/60 bg-muted/10 p-3">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <h4 className="text-sm font-semibold">Primary Actions</h4>
                          <p className="text-xs text-muted-foreground">
                            Use these when progressing the tournament flow.
                          </p>
                        </div>
                      </div>

                      <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-4">
                        {GROUP_STAGE_TYPES.includes(selectedStage.stage_type) &&
                        teams.length > 0 &&
                        selectedStage.items.length > 0 ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={
                              seedTeamsMutation.isPending &&
                              seedTeamsMutation.variables?.stageId === selectedStage.id
                            }
                            onClick={() => {
                              const confirmed = window.confirm(
                                `Distribute ${teams.length} teams into ${selectedStage.items.length} group(s) using snake-SR draft?\n\n` +
                                  "Existing manual team assignments in this stage will be cleared."
                              );
                              if (!confirmed) return;
                              seedTeamsMutation.mutate({
                                stageId: selectedStage.id,
                                mode: "snake_sr"
                              });
                            }}
                            title="Auto-distribute teams into groups balanced by avg_sr"
                          >
                            {seedTeamsMutation.isPending &&
                            seedTeamsMutation.variables?.stageId === selectedStage.id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Shuffle className="size-4" />
                            )}
                            Seed by SR
                          </Button>
                        ) : null}

                        {mergeableGroupStageCandidates.length > 0 ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={
                              mergeGroupStagesMutation.isPending &&
                              mergeGroupStagesMutation.variables?.targetStageId ===
                                selectedStage.id
                            }
                            onClick={() => {
                              const sourceNames = mergeableGroupStageCandidates
                                .map((stage) => stage.name)
                                .join(", ");
                              const confirmed = window.confirm(
                                `Merge ${mergeableGroupStageCandidates.length + 1} ${STAGE_TYPE_LABELS[selectedStage.stage_type]} stages into "${mergedStageName}"?\n\n` +
                                  `${sourceNames} will be removed from the timeline after their groups, matches, and standings move into this stage.`
                              );
                              if (!confirmed) return;
                              mergeGroupStagesMutation.mutate({
                                targetStageId: selectedStage.id,
                                sourceStageIds: mergeableGroupStageCandidates.map((stage) => stage.id),
                                targetName: mergedStageName
                              });
                            }}
                            title="Merge legacy one-group stages into this grouped stage"
                          >
                            {mergeGroupStagesMutation.isPending &&
                            mergeGroupStagesMutation.variables?.targetStageId === selectedStage.id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <GitMerge className="size-4" />
                            )}
                            {mergeGroupStagesMutation.isPending &&
                            mergeGroupStagesMutation.variables?.targetStageId === selectedStage.id
                              ? "Merging..."
                              : "Merge Groups"}
                          </Button>
                        ) : null}

                        {!selectedStage.is_active ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={activateMutation.isPending}
                            onClick={() => activateMutation.mutate(selectedStage.id)}
                          >
                            {activateMutation.isPending &&
                            activateMutation.variables === selectedStage.id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <PlayCircle className="size-4" />
                            )}
                            {activateMutation.isPending &&
                            activateMutation.variables === selectedStage.id
                              ? "Activating..."
                              : "Activate"}
                          </Button>
                        ) : null}

                        <Button
                          size="sm"
                          variant="outline"
                          disabled={generateMutation.isPending}
                          onClick={() => generateMutation.mutate(selectedStage.id)}
                        >
                          {generateMutation.isPending &&
                          generateMutation.variables === selectedStage.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Wand2 className="size-4" />
                          )}
                          {generateMutation.isPending &&
                          generateMutation.variables === selectedStage.id
                            ? "Generating..."
                            : "Generate Bracket"}
                        </Button>

                        {BRACKET_STAGE_TYPES.includes(selectedStage.stage_type) ? (
                          <Button
                            size="sm"
                            disabled={
                              activateAndGenerateMutation.isPending &&
                              activateAndGenerateMutation.variables === selectedStage.id
                            }
                            onClick={() => activateAndGenerateMutation.mutate(selectedStage.id)}
                            title="Resolve tentative inputs from prior stage standings, then generate the bracket"
                          >
                            {activateAndGenerateMutation.isPending &&
                            activateAndGenerateMutation.variables === selectedStage.id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Zap className="size-4" />
                            )}
                            {activateAndGenerateMutation.isPending &&
                            activateAndGenerateMutation.variables === selectedStage.id
                              ? "Working..."
                              : "Activate & Generate"}
                          </Button>
                        ) : null}
                      </div>
                    </section>

                    <section className="rounded-lg border border-border/60 bg-muted/10 p-3">
                      <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <div>
                          <h4 className="text-sm font-semibold">Structure</h4>
                          <p className="text-xs text-muted-foreground">
                            Manage groups, bracket lanes, and assigned teams for this stage.
                          </p>
                        </div>
                        <Badge variant="outline" className="w-fit">
                          {selectedStage.items.length} item(s), {selectedStageSlots} slot(s)
                        </Badge>
                      </div>

                      {selectedStageProgress && selectedStageProgress.items.length > 1 ? (
                        <div className="mb-3 flex flex-wrap gap-1.5">
                          {selectedStageProgress.items.map((itemProgress) => (
                            <Badge
                              key={itemProgress.stage_item_id}
                              variant="outline"
                              className={cn(
                                "text-[11px]",
                                itemProgress.is_completed &&
                                  "border-emerald-700/60 bg-emerald-950/20 text-emerald-300"
                              )}
                            >
                              {itemProgress.name}: {itemProgress.completed}/{itemProgress.total}
                            </Badge>
                          ))}
                        </div>
                      ) : null}

                      {selectedStage.items.length > 0 ? (
                        <div className="grid gap-3 2xl:grid-cols-2">
                          {selectedStage.items.map((item) => (
                            <div
                              key={item.id}
                              className="flex flex-col gap-3 rounded-lg border border-border/60 bg-background/50 p-3"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium">{item.name}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {item.inputs.length} slot(s)
                                  </p>
                                </div>
                                {editingItemTypeId === item.id ? (
                                  <div className="flex shrink-0 items-center gap-1">
                                    <Select
                                      defaultValue={item.type}
                                      onValueChange={(value) => {
                                        updateItemTypeMutation.mutate({
                                          stageItemId: item.id,
                                          type: value as StageItemType
                                        });
                                      }}
                                    >
                                      <SelectTrigger className="h-8 w-36 text-[11px]">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {Object.entries(STAGE_ITEM_TYPE_LABELS).map(
                                          ([value, label]) => (
                                            <SelectItem
                                              key={value}
                                              value={value}
                                              className="text-[11px]"
                                            >
                                              {label}
                                            </SelectItem>
                                          )
                                        )}
                                      </SelectContent>
                                    </Select>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="size-8"
                                      aria-label="Cancel item type edit"
                                      onClick={() => setEditingItemTypeId(null)}
                                    >
                                      <span aria-hidden>×</span>
                                    </Button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    className="flex shrink-0 items-center gap-1 rounded-md border border-transparent px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                    onClick={() => setEditingItemTypeId(item.id)}
                                    title="Click to change type"
                                  >
                                    {STAGE_ITEM_TYPE_LABELS[item.type]}
                                    <Pencil className="size-2.5" />
                                  </button>
                                )}
                              </div>

                              {item.inputs.length > 0 ? (
                                <div className="flex flex-col gap-1">
                                  {[...item.inputs]
                                    .sort((left, right) => left.slot - right.slot)
                                    .map((input) => {
                                      const label = getInputDisplayLabel(input, stages, teamById);
                                      const isEditingThisInput = editingInputId === input.id;
                                      const canSwapAssignedTeams = input.team_id != null;

                                      return (
                                        <div
                                          key={input.id}
                                          className="flex items-center gap-2 rounded-md border border-border/50 bg-background/70 px-2.5 py-1.5 text-xs"
                                        >
                                          <span className="min-w-0 flex-1 truncate">
                                            #{input.slot} {label}
                                          </span>

                                          {isEditingThisInput ? (
                                            <>
                                              <Select
                                                value={editingInputTeamDraft}
                                                onValueChange={setEditingInputTeamDraft}
                                              >
                                                <SelectTrigger className="h-7 w-40 text-[11px]">
                                                  <SelectValue placeholder="Pick team" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                  {teams.map((team) => (
                                                    <SelectItem
                                                      key={team.id}
                                                      value={team.id.toString()}
                                                      disabled={
                                                        selectedStageAssignedTeamIds.has(team.id) &&
                                                        team.id !== input.team_id &&
                                                        !canSwapAssignedTeams
                                                      }
                                                      className="text-[11px]"
                                                    >
                                                      {team.name}
                                                    </SelectItem>
                                                  ))}
                                                </SelectContent>
                                              </Select>
                                              <Button
                                                size="icon"
                                                variant="ghost"
                                                className="size-8 shrink-0"
                                                aria-label="Save team assignment"
                                                disabled={
                                                  !editingInputTeamDraft ||
                                                  (updateInputMutation.isPending &&
                                                    updateInputMutation.variables?.inputId === input.id)
                                                }
                                                onClick={() =>
                                                  updateInputMutation.mutate({
                                                    inputId: input.id,
                                                    teamId: Number(editingInputTeamDraft)
                                                  })
                                                }
                                              >
                                                {updateInputMutation.isPending &&
                                                updateInputMutation.variables?.inputId === input.id ? (
                                                  <Loader2 className="size-3 animate-spin" />
                                                ) : (
                                                  <CheckCircle2 className="size-3" />
                                                )}
                                              </Button>
                                              <Button
                                                size="icon"
                                                variant="ghost"
                                                className="size-8 shrink-0"
                                                aria-label="Cancel team assignment edit"
                                                onClick={() => {
                                                  setEditingInputId(null);
                                                  setEditingInputTeamDraft("");
                                                }}
                                              >
                                                <span aria-hidden>×</span>
                                              </Button>
                                            </>
                                          ) : (
                                            <>
                                              <Badge
                                                variant="outline"
                                                className={cn(
                                                  "shrink-0 text-[10px]",
                                                  input.input_type === "tentative" &&
                                                    "border-amber-700/50 text-amber-300"
                                                )}
                                              >
                                                {input.input_type}
                                              </Badge>
                                              {input.input_type !== "empty" ? (
                                                <button
                                                  type="button"
                                                  className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                                  title={
                                                    input.input_type === "tentative"
                                                      ? "Override team"
                                                      : "Change team"
                                                  }
                                                  onClick={() => {
                                                    setEditingInputId(input.id);
                                                    setEditingInputTeamDraft(
                                                      input.team_id?.toString() ?? ""
                                                    );
                                                  }}
                                                >
                                                  <Pencil className="size-3" />
                                                </button>
                                              ) : null}
                                            </>
                                          )}
                                        </div>
                                      );
                                    })}
                                </div>
                              ) : (
                                <p className="rounded-md border border-dashed border-border/60 bg-background/40 px-3 py-2 text-xs text-muted-foreground">
                                  No teams assigned yet.
                                </p>
                              )}

                              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                                <Select
                                  value={teamDrafts[item.id]}
                                  onValueChange={(value) =>
                                    setTeamDrafts((current) => ({ ...current, [item.id]: value }))
                                  }
                                  disabled={isTeamsLoading || teams.length === 0}
                                >
                                  <SelectTrigger className="h-9">
                                    <SelectValue
                                      placeholder={
                                        isTeamsLoading ? "Loading teams..." : "Select team"
                                      }
                                    />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {teams.map((team) => (
                                      <SelectItem
                                        key={team.id}
                                        value={team.id.toString()}
                                        disabled={selectedStageAssignedTeamIds.has(team.id)}
                                      >
                                        {team.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={
                                    createInputMutation.isPending ||
                                    !teamDrafts[item.id] ||
                                    selectedStageAssignedTeamIds.has(Number(teamDrafts[item.id]))
                                  }
                                  onClick={() =>
                                    createInputMutation.mutate({
                                      stageItemId: item.id,
                                      slot: getNextInputSlot(item),
                                      teamId: Number(teamDrafts[item.id])
                                    })
                                  }
                                >
                                  {createInputMutation.isPending &&
                                  createInputMutation.variables?.stageItemId === item.id ? (
                                    <Loader2 className="size-4 animate-spin" />
                                  ) : (
                                    <Plus className="size-4" />
                                  )}
                                  Add Team
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-lg border border-dashed border-border/70 bg-background/40 p-4 text-sm text-muted-foreground">
                          This stage has no structure items yet. Add a group or bracket lane below.
                        </div>
                      )}

                      <div className="mt-3 grid gap-2 border-t border-border/60 pt-3 lg:grid-cols-[minmax(0,1fr)_200px_auto] lg:items-end">
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor={`stage-item-name-${selectedStage.id}`} className="text-xs">
                            Structure item name
                          </Label>
                          <Input
                            id={`stage-item-name-${selectedStage.id}`}
                            className="h-9"
                            placeholder={nextItemName}
                            value={selectedItemDraft.name}
                            onChange={(event) =>
                              setStageItemDrafts((current) => ({
                                ...current,
                                [selectedStage.id]: {
                                  ...selectedItemDraft,
                                  name: event.target.value
                                }
                              }))
                            }
                          />
                        </div>

                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor={`stage-item-type-${selectedStage.id}`} className="text-xs">
                            Type
                          </Label>
                          <Select
                            value={selectedItemDraft.type}
                            onValueChange={(value) =>
                              setStageItemDrafts((current) => ({
                                ...current,
                                [selectedStage.id]: {
                                  ...selectedItemDraft,
                                  type: value as StageItemType
                                }
                              }))
                            }
                          >
                            <SelectTrigger id={`stage-item-type-${selectedStage.id}`} className="h-9">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Object.entries(STAGE_ITEM_TYPE_LABELS).map(([value, label]) => (
                                <SelectItem key={value} value={value}>
                                  {label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={
                            createItemMutation.isPending &&
                            createItemMutation.variables?.stageId === selectedStage.id
                          }
                          onClick={() =>
                            createItemMutation.mutate({
                              stageId: selectedStage.id,
                              name: selectedItemDraft.name.trim() || nextItemName,
                              type: selectedItemDraft.type,
                              order: selectedStage.items.length
                            })
                          }
                        >
                          {createItemMutation.isPending &&
                          createItemMutation.variables?.stageId === selectedStage.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Plus className="size-4" />
                          )}
                          {createItemMutation.isPending &&
                          createItemMutation.variables?.stageId === selectedStage.id
                            ? "Adding..."
                            : "Add Structure"}
                        </Button>
                      </div>
                    </section>

                    {BRACKET_STAGE_TYPES.includes(selectedStage.stage_type) &&
                    selectedWireDraft &&
                    groupStages.length > 0 ? (
                      <section className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                        <div className="mb-3 flex items-start gap-2">
                          <Link2 className="mt-0.5 size-4 text-primary" />
                          <div>
                            <h4 className="text-sm font-semibold">Automation</h4>
                            <p className="text-xs text-muted-foreground">
                              Auto-populate tentative bracket slots from a preceding group stage.
                            </p>
                          </div>
                        </div>

                        <div
                          className={cn(
                            "grid gap-2",
                            selectedStage.stage_type === "double_elimination"
                              ? "sm:grid-cols-[minmax(0,1fr)_80px_80px_120px_auto]"
                              : "sm:grid-cols-[minmax(0,1fr)_100px_120px_auto]"
                          )}
                        >
                          <Select
                            value={selectedWireDraft.sourceStageId?.toString() ?? ""}
                            onValueChange={(value) =>
                              setWireDrafts((current) => ({
                                ...current,
                                [selectedStage.id]: {
                                  ...selectedWireDraft,
                                  sourceStageId: Number(value)
                                }
                              }))
                            }
                          >
                            <SelectTrigger className="h-9">
                              <SelectValue placeholder="Source group stage" />
                            </SelectTrigger>
                            <SelectContent>
                              {groupStages.map((stage) => (
                                <SelectItem key={stage.id} value={stage.id.toString()}>
                                  {stage.name} ({STAGE_TYPE_LABELS[stage.stage_type]})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>

                          <Input
                            type="number"
                            min={1}
                            max={16}
                            className="h-9"
                            value={selectedWireDraft.top}
                            onChange={(event) =>
                              setWireDrafts((current) => ({
                                ...current,
                                [selectedStage.id]: {
                                  ...selectedWireDraft,
                                  top: Math.max(1, Number(event.target.value) || 1)
                                }
                              }))
                            }
                            title="Teams from each group to Upper Bracket"
                          />

                          {selectedStage.stage_type === "double_elimination" ? (
                            <Input
                              type="number"
                              min={0}
                              max={16}
                              className="h-9"
                              value={selectedWireDraft.top_lb}
                              onChange={(event) =>
                                setWireDrafts((current) => ({
                                  ...current,
                                  [selectedStage.id]: {
                                    ...selectedWireDraft,
                                    top_lb: Math.max(0, Number(event.target.value) || 0)
                                  }
                                }))
                              }
                              title="Teams from each group to Lower Bracket (0 = none)"
                            />
                          ) : null}

                          <Select
                            value={selectedWireDraft.mode}
                            onValueChange={(value) =>
                              setWireDrafts((current) => ({
                                ...current,
                                [selectedStage.id]: {
                                  ...selectedWireDraft,
                                  mode: value as "cross" | "snake"
                                }
                              }))
                            }
                          >
                            <SelectTrigger className="h-9">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="cross">Cross</SelectItem>
                              <SelectItem value="snake">Snake</SelectItem>
                            </SelectContent>
                          </Select>

                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={
                              (wireFromGroupsMutation.isPending &&
                                wireFromGroupsMutation.variables?.targetStageId ===
                                  selectedStage.id) ||
                              !selectedWireDraft.sourceStageId
                            }
                            onClick={() =>
                              selectedWireDraft.sourceStageId &&
                              wireFromGroupsMutation.mutate({
                                targetStageId: selectedStage.id,
                                sourceStageId: selectedWireDraft.sourceStageId,
                                top: selectedWireDraft.top,
                                top_lb: selectedWireDraft.top_lb,
                                mode: selectedWireDraft.mode
                              })
                            }
                          >
                            {wireFromGroupsMutation.isPending &&
                            wireFromGroupsMutation.variables?.targetStageId === selectedStage.id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Link2 className="size-4" />
                            )}
                            {wireFromGroupsMutation.isPending &&
                            wireFromGroupsMutation.variables?.targetStageId === selectedStage.id
                              ? "Wiring..."
                              : "Wire"}
                          </Button>
                        </div>
                      </section>
                    ) : null}

                    {isSuperuser ? (
                      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                        <section className="rounded-lg border border-dashed border-border/70 bg-muted/5">
                          <CollapsibleTrigger asChild>
                            <Button
                              variant="ghost"
                              className="flex h-auto w-full justify-between rounded-lg px-3 py-2.5"
                            >
                              <span className="flex items-center gap-2 text-sm font-semibold">
                                <Shield className="size-4" />
                                Advanced
                              </span>
                              <ChevronDown
                                className={cn(
                                  "size-4 transition-transform",
                                  advancedOpen && "rotate-180"
                                )}
                              />
                            </Button>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <div className="border-t border-border/60 p-3">
                              <div className="mb-3 flex items-start gap-2 text-xs text-muted-foreground">
                                <AlertTriangle className="mt-0.5 size-3.5 text-amber-300" />
                                <span>
                                  Bracket generation override is superuser-only and changes how
                                  future bracket generation interprets this stage.
                                </span>
                              </div>

                              <div className="flex flex-col gap-2 sm:flex-row">
                                <Select
                                  value={selectedStageTypeDraft}
                                  onValueChange={(value) =>
                                    setStageTypeDrafts((current) => ({
                                      ...current,
                                      [selectedStage.id]: value as StageType
                                    }))
                                  }
                                >
                                  <SelectTrigger className="h-9 w-full sm:w-[220px]">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {Object.entries(STAGE_TYPE_LABELS).map(([value, label]) => (
                                      <SelectItem key={value} value={value}>
                                        {label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                {selectedStageTypeDraft === "swiss" ? (
                                  <Input
                                    aria-label="Swiss max rounds"
                                    className="h-9 w-full sm:w-[120px]"
                                    min={1}
                                    step={1}
                                    type="number"
                                    value={selectedStageMaxRoundDraft}
                                    onChange={(event) =>
                                      setStageMaxRoundDrafts((current) => ({
                                        ...current,
                                        [selectedStage.id]: event.target.value
                                      }))
                                    }
                                  />
                                ) : null}
                                {selectedStageTypeDraft === "double_elimination" ? (
                                  <Select
                                    value={selectedStageDeGfTypeDraft}
                                    onValueChange={(value) =>
                                      setStageDeGfTypeDrafts((current) => ({
                                        ...current,
                                        [selectedStage.id]: value as "no_reset" | "with_reset"
                                      }))
                                    }
                                  >
                                    <SelectTrigger className="h-9 w-full sm:w-[160px]">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="no_reset">No Reset</SelectItem>
                                      <SelectItem value="with_reset">With Reset</SelectItem>
                                    </SelectContent>
                                  </Select>
                                ) : null}
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  disabled={
                                    updateStageMutation.isPending ||
                                    !isStageDirty ||
                                    !selectedStage
                                  }
                                  onClick={() =>
                                    updateStageMutation.mutate({
                                      stageId: selectedStage.id,
                                      data: {
                                        stage_type: selectedStageTypeDraft,
                                        max_rounds: maxRoundsDraftValue,
                                        settings_json:
                                          selectedStageTypeDraft === "double_elimination"
                                            ? { de_grand_final_type: selectedStageDeGfTypeDraft }
                                            : undefined
                                      }
                                    })
                                  }
                                >
                                  {updateStageMutation.isPending &&
                                  updateStageMutation.variables?.stageId === selectedStage.id ? (
                                    <Loader2 className="size-4 animate-spin" />
                                  ) : null}
                                  {updateStageMutation.isPending &&
                                  updateStageMutation.variables?.stageId === selectedStage.id
                                    ? "Saving..."
                                    : "Save Override"}
                                </Button>
                              </div>
                            </div>
                          </CollapsibleContent>
                        </section>
                      </Collapsible>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      <EntityFormDialog
        open={createDialogOpen}
        onOpenChange={(open) => {
          setCreateDialogOpen(open);
          if (!open) {
            createMutation.reset();
            resetCreateStageForm();
          }
        }}
        title="Add Stage"
        description="Create the next tournament phase and choose its initial generation format."
        submitLabel="Add Stage"
        submittingLabel="Adding..."
        onSubmit={handleCreateStageSubmit}
        isSubmitting={createMutation.isPending}
        errorMessage={createMutation.isError ? createMutation.error.message : undefined}
        isDirty={createStageDirty}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-stage-name">Stage name</Label>
            <Input
              id="new-stage-name"
              placeholder="Playoffs, Group A, Finals..."
              value={newStageName}
              onChange={(event) => setNewStageName(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="new-stage-type">Stage type</Label>
            <Select value={newStageType} onValueChange={(value) => setNewStageType(value as StageType)}>
              <SelectTrigger id="new-stage-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(STAGE_TYPE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {newStageType === "swiss" ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-stage-max-rounds">Swiss max rounds</Label>
              <Input
                id="new-stage-max-rounds"
                min={1}
                step={1}
                type="number"
                value={newStageMaxRounds}
                onChange={(event) => setNewStageMaxRounds(event.target.value)}
              />
            </div>
          ) : null}

          {newStageType === "double_elimination" ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-stage-grand-final">Grand Final format</Label>
              <Select
                value={newStageDeGrandFinalType}
                onValueChange={(value) =>
                  setNewStageDeGrandFinalType(value as "no_reset" | "with_reset")
                }
              >
                <SelectTrigger id="new-stage-grand-final">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="no_reset">No Reset - UB winner wins after one GF win</SelectItem>
                  <SelectItem value="with_reset">
                    With Reset - LB champion can force a rematch
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>
      </EntityFormDialog>

      <DeleteConfirmDialog
        open={Boolean(stageToDelete)}
        onOpenChange={(open) => {
          if (!open) setStageToDelete(null);
        }}
        onConfirm={() => {
          if (stageToDelete) {
            deleteMutation.mutate(stageToDelete.id);
          }
        }}
        title="Delete Stage"
        description={
          stageToDelete
            ? `Delete "${stageToDelete.name}"? This removes its structure and generated bracket data.`
            : undefined
        }
        cascadeInfo={["Stage structure items", "Team input slots", "Generated stage matches"]}
        isDeleting={deleteMutation.isPending}
      />
    </>
  );
}
