"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, PlayCircle, Plus, Shield, Users, Wand2 } from "lucide-react";
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
import type { Stage, StageType } from "@/types/tournament.types";

const STAGE_TYPE_LABELS: Record<StageType, string> = {
  round_robin: "Round Robin",
  single_elimination: "Single Elimination",
  double_elimination: "Double Elimination",
  swiss: "Swiss"
};

interface StageManagerProps {
  tournamentId: number;
}

function getStageTeamSlots(stage: Stage) {
  return stage.items.reduce((acc, item) => acc + item.inputs.length, 0);
}

function formatStageItemType(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function StageManager({ tournamentId }: StageManagerProps) {
  const queryClient = useQueryClient();
  const { isSuperuser } = usePermissions();
  const [newStageName, setNewStageName] = useState("");
  const [newStageType, setNewStageType] = useState<StageType>("round_robin");
  const [stageTypeDrafts, setStageTypeDrafts] = useState<Record<number, StageType>>({});

  const { data: stages = [], isLoading } = useQuery({
    queryKey: ["admin", "stages", tournamentId],
    queryFn: () => adminService.getStages(tournamentId)
  });

  const createMutation = useMutation({
    mutationFn: () =>
      adminService.createStage(tournamentId, {
        name: newStageName,
        stage_type: newStageType,
        order: stages.length
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["admin", "stages", tournamentId]
      });
      setNewStageName("");
    }
  });

  const updateStageMutation = useMutation({
    mutationFn: ({ stageId, data }: { stageId: number; data: { stage_type: StageType } }) =>
      adminService.updateStage(stageId, data),
    onSuccess: (_stage, variables) => {
      setStageTypeDrafts((current) => {
        const next = { ...current };
        delete next[variables.stageId];
        return next;
      });
      queryClient.invalidateQueries({
        queryKey: ["admin", "stages", tournamentId]
      });
    }
  });

  const activateMutation = useMutation({
    mutationFn: (stageId: number) => adminService.activateStage(stageId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["admin", "stages", tournamentId]
      });
    }
  });

  const generateMutation = useMutation({
    mutationFn: (stageId: number) => adminService.generateBracket(stageId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["admin", "stages", tournamentId]
      });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (stageId: number) => adminService.deleteStage(stageId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["admin", "stages", tournamentId]
      });
    }
  });

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
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_auto] lg:items-end">
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
        const isTypeDirty = stageTypeDraft !== stage.stage_type;
        const isUpdatingType =
          updateStageMutation.isPending && updateStageMutation.variables?.stageId === stage.id;
        const isActivating = activateMutation.isPending && activateMutation.variables === stage.id;
        const isGenerating = generateMutation.isPending && generateMutation.variables === stage.id;
        const isDeleting = deleteMutation.isPending && deleteMutation.variables === stage.id;
        const teamSlots = getStageTeamSlots(stage);

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
                    <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/20 px-2.5 py-1">
                      <Users className="size-3" />
                      {teamSlots} slot(s)
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 xl:justify-end">
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
                  <div className="flex flex-wrap gap-2">
                    {stage.items.map((item) => (
                      <div
                        key={item.id}
                        className="flex min-w-[220px] items-center justify-between gap-3 rounded-md border border-border/60 bg-muted/20 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{item.name}</p>
                          <p className="text-xs text-muted-foreground">{item.inputs.length} slot(s)</p>
                        </div>
                        <Badge variant="secondary" className="shrink-0 text-[11px]">
                          {formatStageItemType(item.type)}
                        </Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    This stage has no structure items yet.
                  </p>
                )}
              </div>

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
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={updateStageMutation.isPending || !isTypeDirty}
                        onClick={() =>
                          updateStageMutation.mutate({
                            stageId: stage.id,
                            data: { stage_type: stageTypeDraft }
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
