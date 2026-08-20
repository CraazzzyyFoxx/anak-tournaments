"use client";

import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";

import { TONE_CLASS } from "@/components/admin/tone";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import workspaceService from "@/services/workspace.service";
import type { DivisionGridReadinessSource, DivisionTier } from "@/types/workspace.types";

type Props = {
  workspaceId: number;
  targetVersionId: number;
  targetTiers: DivisionTier[];
  sources: DivisionGridReadinessSource[];
  canEdit: boolean;
  onResolved: () => void | Promise<void>;
};

function selectionKey(sourceVersionId: number, sourceTierId: number) {
  return `${sourceVersionId}:${sourceTierId}`;
}

export function DivisionGridConflictResolver({
  workspaceId,
  targetVersionId,
  targetTiers,
  sources,
  canEdit,
  onResolved
}: Readonly<Props>) {
  const pending = useMemo(
    () => sources.filter((source) => source.conflict_tiers.length > 0),
    [sources]
  );
  const [selections, setSelections] = useState<Map<string, number>>(() => new Map());

  const totalConflicts = pending.reduce((sum, source) => sum + source.conflict_tiers.length, 0);
  const assignedCount = pending.reduce(
    (sum, source) =>
      sum +
      source.conflict_tiers.filter(
        (tier) => selections.get(selectionKey(source.version_id, tier.source_tier_id)) != null
      ).length,
    0
  );
  const allAssigned = totalConflicts > 0 && assignedCount === totalConflicts;

  const resolveMutation = useMutation({
    mutationFn: async () => {
      for (const source of pending) {
        const conflictSourceIds = new Set(
          source.conflict_tiers.map((tier) => tier.source_tier_id)
        );
        const existing = await workspaceService
          .getDivisionGridMapping(source.version_id, targetVersionId)
          .then((mapping) => mapping.rules)
          .catch(() => []);

        const merged = [
          ...existing.filter((rule) => !conflictSourceIds.has(rule.source_tier_id)),
          ...source.conflict_tiers.map((tier) => ({
            source_tier_id: tier.source_tier_id,
            target_tier_id: selections.get(selectionKey(source.version_id, tier.source_tier_id))!,
            weight: 1,
            is_primary: true
          }))
        ];

        await workspaceService.putDivisionGridMapping(source.version_id, targetVersionId, {
          name: `Resolved \u2192 v${targetVersionId}`,
          rules: merged
        });
      }
      await workspaceService.activateDivisionGridVersion(workspaceId, targetVersionId);
    },
    onSuccess: async () => {
      notify.success("Conflicts resolved and grid activated");
      await onResolved();
    },
    onError: () =>
      notify.error("Conflicts could not be resolved", {
        description:
          "The mappings were not saved and the grid is still inactive. Check every target division above, then try again."
      })
  });

  if (pending.length === 0) return null;

  return (
    <Card className="border-warning/40">
      <CardHeader>
        <div className="flex items-center gap-2">
          <AlertCircle aria-hidden className="h-5 w-5 text-warning" />
          <CardTitle asChild>
            <h2>Resolve mapping conflicts</h2>
          </CardTitle>
        </div>
        <CardDescription>
          The new grid could not be auto-mapped from every version still used by tournaments. Pick a
          target division for each unmatched tier, then activate.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {pending.map((source) => (
          <div key={source.version_id} className="rounded-md border p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-medium">
                {source.grid_name} · {source.version_label}
              </div>
              <Badge variant="secondary" className="tabular-nums">
                {source.tournament_count} tournament(s)
                {source.tournament_names.length > 0
                  ? `: ${source.tournament_names.join(", ")}`
                  : ""}
              </Badge>
            </div>
            <div className="space-y-2">
              {source.conflict_tiers.map((tier) => {
                const key = selectionKey(source.version_id, tier.source_tier_id);
                const selectedId = selections.get(key);
                const mappedTo = targetTiers.find((target) => target.id === selectedId) ?? null;
                return (
                  <div key={key} className="flex flex-wrap items-center gap-3">
                    <span className="min-w-40 text-sm text-muted-foreground">{tier.name}</span>
                    <Select
                      value={selectedId?.toString() ?? ""}
                      onValueChange={(value) =>
                        setSelections((current) => new Map(current).set(key, Number(value)))
                      }
                      disabled={!canEdit}
                    >
                      <SelectTrigger
                        className="w-64"
                        aria-label={`Target division for ${tier.name} from ${source.grid_name} ${source.version_label}`}
                      >
                        <SelectValue placeholder="Map to division" />
                      </SelectTrigger>
                      <SelectContent>
                        {targetTiers.map((target) => (
                          <SelectItem key={target.id} value={String(target.id)}>
                            {target.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {/* Per-row outcome in words: the tint alone would make it colour-only. */}
                    <span
                      className={cn(
                        "rounded-md border px-2 py-0.5 text-xs",
                        TONE_CLASS[mappedTo ? "success" : "warning"]
                      )}
                    >
                      {mappedTo ? `Mapped to ${mappedTo.name}` : "Not mapped yet"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={() => resolveMutation.mutate()}
            disabled={!canEdit || !allAssigned || resolveMutation.isPending}
          >
            Resolve conflicts and activate
          </Button>
          <span className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
            {assignedCount}/{totalConflicts} resolved
          </span>
          <p className="basis-full text-xs text-muted-foreground">
            Saves every mapping above for each listed version, then activates the new grid for this
            workspace. Available once every tier has a target division.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
