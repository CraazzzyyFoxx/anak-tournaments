"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Link2,
  Loader2,
  PlayCircle,
  Plus,
  Shield,
  Shuffle,
  Users,
  Wand2,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePermissions } from "@/hooks/usePermissions";
import adminService from "@/services/admin.service";
import teamService from "@/services/team.service";
import type { Stage, StageItem, StageItemType, StageType } from "@/types/tournament.types";
import type { Team } from "@/types/team.types";
import { invalidateTournamentWorkspace } from "./tournamentWorkspace.queryKeys";

const BRACKET_STAGE_TYPES: StageType[] = [
  "single_elimination",
  "double_elimination",
];
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

function getStageTeamSlots(stage: Stage) {
  return stage.items.reduce((acc, item) => acc + item.inputs.length, 0);
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
      item.inputs
        .map((input) => input.team_id)
        .filter((teamId): teamId is number => teamId != null)
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

export function StageManager({ tournamentId }: StageManagerProps) {
  const queryClient = useQueryClient();
  const { isSuperuser } = usePermissions();
  const [newStageName, setNewStageName] = useState("");
  const [newStageType, setNewStageType] = useState<StageType>("round_robin");
  const [newStageMaxRounds, setNewStageMaxRounds] = useState("5");
  const [stageTypeDrafts, setStageTypeDrafts] = useState<Record<number, StageType>>({});
  const [stageMaxRoundDrafts, setStageMaxRoundDrafts] = useState<Record<number, string>>({});
  const [stageItemDrafts, setStageItemDrafts] = useState<Record<number, StageItemDraft>>({});
  const [teamDrafts, setTeamDrafts] = useState<Record<number, string>>({});

  const { data: stages = [], isLoading } = useQuery({
    queryKey: ["admin", "stages", tournamentId],
    queryFn: () => adminService.getStages(tournamentId)
  });

  const { data: teamsData, isLoading: isTeamsLoading } = useQuery({
    queryKey: ["admin", "tournament", "teams", tournamentId],
    queryFn: () => teamService.getAll(tournamentId, "name", "asc")
  });

  // Progress (completed/total encounter counts per stage and stage_item).
  // Drives the "Group A — 8/10 done" badges and the activate-and-generate
  // safety check on the frontend (P0.4).
  const { data: stageProgress = [] } = useQuery({
    queryKey: ["admin", "stages", tournamentId, "progress"],
    queryFn: () => adminService.getStagesProgress(tournamentId),
    enabled: stages.length > 0,
  });

  const progressByStageId = new Map(
    stageProgress.map((sp) => [sp.stage_id, sp])
  );

  const teams = teamsData?.results ?? [];
  const teamById = new Map(teams.map((team) => [team.id, team]));

  const invalidateStageData = () => {
    // Single source of truth for tournament workspace cache invalidation.
    // Keeps admin StageManager, public bracket view and all dependent queries
    // aligned (Phase F).
    void invalidateTournamentWorkspace(queryClient, tournamentId);
  };

  const createMutation = useMutation({
    mutationFn: () =>
      adminService.createStage(tournamentId, {
        name: newStageName,
        stage_type: newStageType,
        max_rounds: normalizeMaxRounds(newStageMaxRounds),
        order: stages.length
      }),
    onSuccess: () => {
      invalidateStageData();
      setNewStageName("");
      setNewStageMaxRounds("5");
    }
  });

  const updateStageMutation = useMutation({
    mutationFn: ({
      stageId,
      data
    }: {
      stageId: number;
      data: { stage_type?: StageType; max_rounds?: number };
    }) =>
      adminService.updateStage(stageId, data),
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

  // Phase F2: auto-wire TENTATIVE inputs from group stage into playoffs.
  const wireFromGroupsMutation = useMutation({
    mutationFn: ({
      targetStageId,
      sourceStageId,
      top,
      mode,
    }: {
      targetStageId: number;
      sourceStageId: number;
      top: number;
      mode: "cross" | "snake";
    }) =>
      adminService.wireFromGroups(targetStageId, {
        source_stage_id: sourceStageId,
        top,
        mode,
      }),
    onSuccess: () => {
      invalidateStageData();
    },
  });

  // Phase F2: one-click activate + generate. On 409 (upstream not completed)
  // prompt the admin and retry with force=true on confirm.
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
    },
  });

  // P0.2: seed teams into group stage automatically by avg_sr snake-draft.
  const seedTeamsMutation = useMutation({
    mutationFn: ({
      stageId,
      mode,
    }: {
      stageId: number;
      mode: "snake_sr" | "by_total_sr" | "random";
    }) => {
      const teamIds = (teamsData?.results ?? []).map((t) => t.id);
      return adminService.seedTeams(stageId, { team_ids: teamIds, mode });
    },
    onSuccess: () => {
      invalidateStageData();
    },
  });

  // Local UI state for the wire-from-groups form (keyed per bracket stage).
  const [wireDrafts, setWireDrafts] = useState<
    Record<number, { sourceStageId?: number; top: number; mode: "cross" | "snake" }>
  >({});

  if (isLoading) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex items-center gap-3 pt-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading stages...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-lg font-semibold">Stages</h3>
        <p className="text-sm text-muted-foreground">
          Configure tournament phases, see their structure at a glance, and run stage actions
          without scanning through dense rows.
        </p>
      </div>

      <Card className="border-dashed">
        <CardHeader className="gap-1 pb-3">
          <CardTitle className="text-base">Add Stage</CardTitle>
          <p className="text-sm text-muted-foreground">
            Create the next tournament phase and choose its initial format before generating a
            bracket.
          </p>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_150px_auto] lg:items-end">
            <div className="space-y-2">
              <Label htmlFor="new-stage-name">Stage name</Label>
              <Input
                id="new-stage-name"
                placeholder="Playoffs, Group A, Finals..."
                value={newStageName}
                onChange={(e) => setNewStageName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-stage-type">Stage type</Label>
              <Select value={newStageType} onValueChange={(v) => setNewStageType(v as StageType)}>
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

            <div className="space-y-2">
              <Label htmlFor="new-stage-max-rounds">Swiss max rounds</Label>
              <Input
                id="new-stage-max-rounds"
                min={1}
                step={1}
                type="number"
                value={newStageMaxRounds}
                onChange={(e) => setNewStageMaxRounds(e.target.value)}
              />
            </div>

            <Button
              className="w-full lg:w-auto"
              disabled={!newStageName || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Plus className="mr-2 size-4" />
              )}
              {createMutation.isPending ? "Adding..." : "Add Stage"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {stages.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="space-y-1 pt-6">
            <p className="text-sm font-medium">No stages yet</p>
            <p className="text-sm text-muted-foreground">
              Create the first stage below to define how this tournament starts.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {stages.map((stage: Stage) => {
        const stageTypeDraft = stageTypeDrafts[stage.id] ?? stage.stage_type;
        const stageMaxRoundDraft =
          stageMaxRoundDrafts[stage.id] ?? String(stage.max_rounds ?? 5);
        const itemDraft = stageItemDrafts[stage.id] ?? {
          name: "",
          type: getDefaultStageItemType(stage.stage_type)
        };
        const isTypeDirty = stageTypeDraft !== stage.stage_type;
        const maxRoundsDraftValue = normalizeMaxRounds(
          stageMaxRoundDraft,
          stage.max_rounds ?? 5
        );
        const isMaxRoundsDirty = maxRoundsDraftValue !== (stage.max_rounds ?? 5);
        const isStageDirty = isTypeDirty || isMaxRoundsDirty;
        const isUpdatingType =
          updateStageMutation.isPending && updateStageMutation.variables?.stageId === stage.id;
        const isActivating = activateMutation.isPending && activateMutation.variables === stage.id;
        const isGenerating = generateMutation.isPending && generateMutation.variables === stage.id;
        const isDeleting = deleteMutation.isPending && deleteMutation.variables === stage.id;
        const isCreatingItem =
          createItemMutation.isPending && createItemMutation.variables?.stageId === stage.id;
        const teamSlots = getStageTeamSlots(stage);
        const assignedTeamIds = getAssignedTeamIds(stage);
        const nextItemName =
          itemDraft.type === "group" ? `Group ${stage.items.length + 1}` : "Bracket";

        return (
          <Card key={stage.id} className="overflow-hidden">
            <CardHeader className="gap-2 pb-2">
              <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="text-base">{stage.name}</CardTitle>
                    <Badge variant="outline">{STAGE_TYPE_LABELS[stage.stage_type]}</Badge>
                    {stage.is_active ? (
                      <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
                        Active
                      </Badge>
                    ) : null}
                    {stage.is_completed ? (
                      <Badge className="bg-slate-600 text-white hover:bg-slate-600">
                        Completed
                      </Badge>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="rounded-full border border-border/60 bg-muted/20 px-2.5 py-1">
                      {STAGE_TYPE_LABELS[stage.stage_type]}
                    </span>
                    <span className="rounded-full border border-border/60 bg-muted/20 px-2.5 py-1">
                      {stage.items.length} item(s)
                    </span>
                    {stage.stage_type === "swiss" ? (
                      <span className="rounded-full border border-border/60 bg-muted/20 px-2.5 py-1">
                        {stage.max_rounds ?? 5} max round(s)
                      </span>
                    ) : null}
                    <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/20 px-2.5 py-1">
                      <Users className="size-3" />
                      {teamSlots} slot(s)
                    </span>
                    {(() => {
                      const prog = progressByStageId.get(stage.id);
                      if (!prog || prog.total === 0) return null;
                      const fullyDone = prog.is_completed;
                      return (
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 ${
                            fullyDone
                              ? "border-emerald-700/60 bg-emerald-950/20 text-emerald-300"
                              : "border-amber-700/50 bg-amber-950/10 text-amber-200"
                          }`}
                          title={
                            fullyDone
                              ? "All encounters in this stage are completed"
                              : `${prog.total - prog.completed} encounters still pending`
                          }
                        >
                          {fullyDone ? (
                            <CheckCircle2 className="size-3" />
                          ) : null}
                          {prog.completed}/{prog.total} matches
                        </span>
                      );
                    })()}
                  </div>
                  {(() => {
                    const prog = progressByStageId.get(stage.id);
                    if (!prog || prog.items.length <= 1) return null;
                    return (
                      <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                        {prog.items.map((it) => (
                          <span
                            key={it.stage_item_id}
                            className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 ${
                              it.is_completed
                                ? "border-emerald-800/50 bg-emerald-950/20 text-emerald-300"
                                : "border-border/60 bg-background/50"
                            }`}
                          >
                            {it.name}: {it.completed}/{it.total}
                          </span>
                        ))}
                      </div>
                    );
                  })()}
                </div>

                <div className="flex flex-wrap gap-2 xl:justify-end">
                  {GROUP_STAGE_TYPES.includes(stage.stage_type) &&
                  (teamsData?.results.length ?? 0) > 0 &&
                  stage.items.length > 0 ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={
                        seedTeamsMutation.isPending &&
                        seedTeamsMutation.variables?.stageId === stage.id
                      }
                      onClick={() => {
                        const teamCount = teamsData?.results.length ?? 0;
                        const confirmed = window.confirm(
                          `Distribute ${teamCount} teams into ${stage.items.length} group(s) using snake-SR draft?\n\n` +
                            "Existing manual team assignments in this stage will be cleared."
                        );
                        if (!confirmed) return;
                        seedTeamsMutation.mutate({
                          stageId: stage.id,
                          mode: "snake_sr",
                        });
                      }}
                      title="Auto-distribute teams into groups balanced by avg_sr"
                    >
                      {seedTeamsMutation.isPending &&
                      seedTeamsMutation.variables?.stageId === stage.id ? (
                        <Loader2 className="mr-2 size-4 animate-spin" />
                      ) : (
                        <Shuffle className="mr-2 size-4" />
                      )}
                      Seed by SR
                    </Button>
                  ) : null}
                  {!stage.is_active ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={activateMutation.isPending}
                      onClick={() => activateMutation.mutate(stage.id)}
                    >
                      {isActivating ? (
                        <Loader2 className="mr-2 size-4 animate-spin" />
                      ) : (
                        <PlayCircle className="mr-2 size-4" />
                      )}
                      {isActivating ? "Activating..." : "Activate"}
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={generateMutation.isPending}
                    onClick={() => generateMutation.mutate(stage.id)}
                  >
                    {isGenerating ? (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    ) : (
                      <Wand2 className="mr-2 size-4" />
                    )}
                    {isGenerating ? "Generating..." : "Generate Bracket"}
                  </Button>
                  {BRACKET_STAGE_TYPES.includes(stage.stage_type) ? (
                    <Button
                      size="sm"
                      variant="default"
                      disabled={
                        activateAndGenerateMutation.isPending &&
                        activateAndGenerateMutation.variables === stage.id
                      }
                      onClick={() => activateAndGenerateMutation.mutate(stage.id)}
                      title="Resolve tentative inputs from prior stage standings, then generate the bracket"
                    >
                      {activateAndGenerateMutation.isPending &&
                      activateAndGenerateMutation.variables === stage.id ? (
                        <Loader2 className="mr-2 size-4 animate-spin" />
                      ) : (
                        <Zap className="mr-2 size-4" />
                      )}
                      Activate & Generate
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={deleteMutation.isPending}
                    onClick={() => deleteMutation.mutate(stage.id)}
                  >
                    {isDeleting ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                    {isDeleting ? "Deleting..." : "Delete"}
                  </Button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-2 pt-0">
              <div className="rounded-lg border border-border/60 bg-background/50 px-3 py-2.5">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    Structure
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {stage.items.length} item(s), {teamSlots} slot(s)
                  </p>
                </div>
                {stage.items.length > 0 ? (
                  <div className="grid gap-3 xl:grid-cols-2">
                    {stage.items.map((item) => (
                      <div
                        key={item.id}
                        className="space-y-3 rounded-md border border-border/60 bg-muted/20 px-3 py-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{item.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {item.inputs.length} slot(s)
                            </p>
                          </div>
                          <Badge variant="secondary" className="shrink-0 text-[11px]">
                            {STAGE_ITEM_TYPE_LABELS[item.type]}
                          </Badge>
                        </div>

                        {item.inputs.length > 0 ? (
                          <div className="space-y-1">
                            {[...item.inputs]
                              .sort((left, right) => left.slot - right.slot)
                              .map((input) => {
                                // For TENTATIVE inputs show the human-readable
                                // source — "Winner of Group A #1" — instead of
                                // "Empty slot" which misleads the admin.
                                let label: string;
                                if (input.team_id != null) {
                                  label = getTeamName(teamById, input.team_id);
                                } else if (
                                  input.input_type === "tentative" &&
                                  input.source_stage_item_id != null &&
                                  input.source_position != null
                                ) {
                                  const sourceItem = stages
                                    .flatMap((s) => s.items)
                                    .find((it) => it.id === input.source_stage_item_id);
                                  const groupName = sourceItem?.name ?? `Item ${input.source_stage_item_id}`;
                                  label = `Winner of ${groupName} #${input.source_position}`;
                                } else {
                                  label = "Empty slot";
                                }
                                return (
                                  <div
                                    key={input.id}
                                    className="flex items-center justify-between gap-2 rounded-md border border-border/50 bg-background/50 px-2.5 py-1.5 text-xs"
                                  >
                                    <span className="min-w-0 truncate">
                                      #{input.slot} {label}
                                    </span>
                                    <Badge
                                      variant="outline"
                                      className={`shrink-0 text-[10px] ${
                                        input.input_type === "tentative"
                                          ? "border-amber-700/50 text-amber-300"
                                          : ""
                                      }`}
                                    >
                                      {input.input_type}
                                    </Badge>
                                  </div>
                                );
                              })}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">No teams assigned yet.</p>
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
                                placeholder={isTeamsLoading ? "Loading teams..." : "Select team"}
                              />
                            </SelectTrigger>
                            <SelectContent>
                              {teams.map((team) => (
                                <SelectItem
                                  key={team.id}
                                  value={team.id.toString()}
                                  disabled={assignedTeamIds.has(team.id)}
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
                              assignedTeamIds.has(Number(teamDrafts[item.id]))
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
                              <Loader2 className="mr-2 size-4 animate-spin" />
                            ) : (
                              <Plus className="mr-2 size-4" />
                            )}
                            Add Team
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    This stage has no structure items yet.
                  </p>
                )}

                <div className="mt-3 grid gap-2 border-t border-border/60 pt-3 lg:grid-cols-[minmax(0,1fr)_200px_auto] lg:items-end">
                  <div className="space-y-1.5">
                    <Label htmlFor={`stage-item-name-${stage.id}`} className="text-xs">
                      Structure item name
                    </Label>
                    <Input
                      id={`stage-item-name-${stage.id}`}
                      className="h-9"
                      placeholder={nextItemName}
                      value={itemDraft.name}
                      onChange={(event) =>
                        setStageItemDrafts((current) => ({
                          ...current,
                          [stage.id]: { ...itemDraft, name: event.target.value }
                        }))
                      }
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor={`stage-item-type-${stage.id}`} className="text-xs">
                      Type
                    </Label>
                    <Select
                      value={itemDraft.type}
                      onValueChange={(value) =>
                        setStageItemDrafts((current) => ({
                          ...current,
                          [stage.id]: { ...itemDraft, type: value as StageItemType }
                        }))
                      }
                    >
                      <SelectTrigger id={`stage-item-type-${stage.id}`} className="h-9">
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
                    disabled={isCreatingItem}
                    onClick={() =>
                      createItemMutation.mutate({
                        stageId: stage.id,
                        name: itemDraft.name.trim() || nextItemName,
                        type: itemDraft.type,
                        order: stage.items.length
                      })
                    }
                  >
                    {isCreatingItem ? (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    ) : (
                      <Plus className="mr-2 size-4" />
                    )}
                    {isCreatingItem ? "Adding..." : "Add Structure"}
                  </Button>
                </div>
              </div>

              {BRACKET_STAGE_TYPES.includes(stage.stage_type) ? (() => {
                const groupStages = stages.filter((other) =>
                  GROUP_STAGE_TYPES.includes(other.stage_type) && other.id !== stage.id
                );
                if (groupStages.length === 0) {
                  return null;
                }
                const draft = wireDrafts[stage.id] ?? {
                  sourceStageId: groupStages[0]?.id,
                  top: 2,
                  mode: "cross" as const,
                };
                const isWiring =
                  wireFromGroupsMutation.isPending &&
                  wireFromGroupsMutation.variables?.targetStageId === stage.id;
                return (
                  <div className="rounded-lg border border-dashed border-emerald-900/40 bg-emerald-950/10 px-3 py-2.5">
                    <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                      <Link2 className="size-3.5" />
                      <span className="font-medium text-foreground">
                        Wire from groups
                      </span>
                      <span className="hidden sm:inline">
                        Auto-populate tentative slots from a preceding group stage.
                      </span>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_100px_120px_auto]">
                      <Select
                        value={draft.sourceStageId?.toString() ?? ""}
                        onValueChange={(value) =>
                          setWireDrafts((current) => ({
                            ...current,
                            [stage.id]: { ...draft, sourceStageId: Number(value) },
                          }))
                        }
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Source group stage" />
                        </SelectTrigger>
                        <SelectContent>
                          {groupStages.map((src) => (
                            <SelectItem key={src.id} value={src.id.toString()}>
                              {src.name} ({STAGE_TYPE_LABELS[src.stage_type]})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <Input
                        type="number"
                        min={1}
                        max={16}
                        className="h-9"
                        value={draft.top}
                        onChange={(event) =>
                          setWireDrafts((current) => ({
                            ...current,
                            [stage.id]: {
                              ...draft,
                              top: Math.max(1, Number(event.target.value) || 1),
                            },
                          }))
                        }
                        title="How many teams advance from each group"
                      />

                      <Select
                        value={draft.mode}
                        onValueChange={(value) =>
                          setWireDrafts((current) => ({
                            ...current,
                            [stage.id]: {
                              ...draft,
                              mode: value as "cross" | "snake",
                            },
                          }))
                        }
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="cross">Cross (avoid rematch)</SelectItem>
                          <SelectItem value="snake">Snake (top-down)</SelectItem>
                        </SelectContent>
                      </Select>

                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={isWiring || !draft.sourceStageId}
                        onClick={() =>
                          draft.sourceStageId &&
                          wireFromGroupsMutation.mutate({
                            targetStageId: stage.id,
                            sourceStageId: draft.sourceStageId,
                            top: draft.top,
                            mode: draft.mode,
                          })
                        }
                      >
                        {isWiring ? (
                          <Loader2 className="mr-2 size-4 animate-spin" />
                        ) : (
                          <Link2 className="mr-2 size-4" />
                        )}
                        {isWiring ? "Wiring..." : "Wire"}
                      </Button>
                    </div>
                  </div>
                );
              })() : null}

              {isSuperuser ? (
                <div className="rounded-lg border border-dashed border-border/70 bg-muted/10 px-3 py-2.5">
                  <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Shield className="size-3.5" />
                      <span className="font-medium text-foreground">Bracket generation override</span>
                      <span className="hidden sm:inline">Superuser only.</span>
                    </div>

                    <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
                      <Select
                        value={stageTypeDraft}
                        onValueChange={(value) =>
                          setStageTypeDrafts((current) => ({
                            ...current,
                            [stage.id]: value as StageType
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
                      <Input
                        aria-label="Swiss max rounds"
                        className="h-9 w-full sm:w-[120px]"
                        min={1}
                        step={1}
                        type="number"
                        value={stageMaxRoundDraft}
                        onChange={(event) =>
                          setStageMaxRoundDrafts((current) => ({
                            ...current,
                            [stage.id]: event.target.value
                          }))
                        }
                      />
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={updateStageMutation.isPending || !isStageDirty}
                        onClick={() =>
                          updateStageMutation.mutate({
                            stageId: stage.id,
                            data: {
                              stage_type: stageTypeDraft,
                              max_rounds: maxRoundsDraftValue
                            }
                          })
                        }
                      >
                        {isUpdatingType ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                        {isUpdatingType ? "Saving..." : "Save Override"}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
