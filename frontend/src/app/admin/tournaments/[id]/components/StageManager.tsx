"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

  if (isLoading) return <div>Loading stages...</div>;

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Stages</h3>

      {stages.map((stage: Stage) => (
        <Card key={stage.id}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                {stage.name}
                <Badge variant="outline" className="ml-2">
                  {STAGE_TYPE_LABELS[stage.stage_type]}
                </Badge>
                {stage.is_active && <Badge className="ml-2 bg-green-500 text-white">Active</Badge>}
                {stage.is_completed && (
                  <Badge className="ml-2 bg-gray-500 text-white">Completed</Badge>
                )}
              </CardTitle>
              <div className="flex gap-2">
                {!stage.is_active && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={activateMutation.isPending}
                    onClick={() => activateMutation.mutate(stage.id)}
                  >
                    Activate
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={generateMutation.isPending}
                  onClick={() => generateMutation.mutate(stage.id)}
                >
                  Generate Bracket
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate(stage.id)}
                >
                  Delete
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isSuperuser ? (
              <div className="mb-4 flex flex-col gap-2 rounded-lg border border-border/50 bg-muted/20 p-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">Stage type override</p>
                  <p className="text-xs text-muted-foreground">
                    Superuser-only. Changes bracket generation behavior for this stage.
                  </p>
                </div>
                <Select
                  value={stageTypeDrafts[stage.id] ?? stage.stage_type}
                  onValueChange={(value) =>
                    setStageTypeDrafts((current) => ({
                      ...current,
                      [stage.id]: value as StageType
                    }))
                  }
                >
                  <SelectTrigger className="w-full sm:w-[220px]">
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
                  disabled={
                    updateStageMutation.isPending ||
                    (stageTypeDrafts[stage.id] ?? stage.stage_type) === stage.stage_type
                  }
                  onClick={() =>
                    updateStageMutation.mutate({
                      stageId: stage.id,
                      data: { stage_type: stageTypeDrafts[stage.id] ?? stage.stage_type }
                    })
                  }
                >
                  Save Type
                </Button>
              </div>
            ) : null}
            <div className="text-sm text-muted-foreground">
              {stage.items.length} item(s),{" "}
              {stage.items.reduce((acc, item) => acc + item.inputs.length, 0)} team slot(s)
            </div>
            {stage.items.map((item) => (
              <div key={item.id} className="mt-1 text-sm">
                <span className="font-medium">{item.name}</span>
                <Badge variant="secondary" className="ml-1 text-xs">
                  {item.type}
                </Badge>
                <span className="ml-2 text-muted-foreground">{item.inputs.length} teams</span>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardContent className="pt-4">
          <div className="flex gap-2">
            <Input
              placeholder="Stage name"
              value={newStageName}
              onChange={(e) => setNewStageName(e.target.value)}
              className="flex-1"
            />
            <Select value={newStageType} onValueChange={(v) => setNewStageType(v as StageType)}>
              <SelectTrigger className="w-[200px]">
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
              disabled={!newStageName || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              Add Stage
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
