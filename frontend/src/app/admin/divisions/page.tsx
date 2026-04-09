"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import Image from "next/image";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspaceStore } from "@/stores/workspace.store";
import workspaceService from "@/services/workspace.service";
import { DivisionGrid, DivisionTier } from "@/types/workspace.types";

function buildDefaultTiers(): DivisionTier[] {
  return Array.from({ length: 20 }, (_, i) => {
    const num = 20 - i;
    return {
      number: num,
      name: `Division ${num}`,
      rank_min: num === 1 ? 2000 : i * 100,
      rank_max: num === 1 ? null : i * 100 + 99,
      icon_path: `/divisions/${num}.png`,
    };
  }).sort((a, b) => a.number - b.number);
}

function emptyTier(number: number): DivisionTier {
  return {
    number,
    name: `Division ${number}`,
    rank_min: 0,
    rank_max: 99,
    icon_path: `/divisions/${number}.png`,
  };
}

export default function DivisionsAdminPage() {
  const { toast } = useToast();
  const { isSuperuser, isWorkspaceAdmin } = usePermissions();
  const queryClient = useQueryClient();
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const getCurrentWorkspace = useWorkspaceStore((s) => s.getCurrentWorkspace);
  const fetchWorkspaces = useWorkspaceStore((s) => s.fetchWorkspaces);
  const workspace = getCurrentWorkspace();

  const isCustom = !!workspace?.division_grid;
  const canEdit = isSuperuser || (currentWorkspaceId !== null && isWorkspaceAdmin(currentWorkspaceId));

  const initialTiers = useMemo(
    () =>
      workspace?.division_grid?.tiers
        ? [...workspace.division_grid.tiers].sort((a, b) => a.number - b.number)
        : buildDefaultTiers(),
    [workspace?.division_grid]
  );

  const [tiers, setTiers] = useState<DivisionTier[]>(initialTiers);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setTiers(initialTiers);
    setDirty(false);
  }, [initialTiers]);

  const updateTier = useCallback((index: number, field: keyof DivisionTier, value: string | number | null) => {
    setTiers((prev) => prev.map((t, i) => (i === index ? { ...t, [field]: value } : t)));
    setDirty(true);
  }, []);

  const addTier = useCallback(() => {
    setTiers((prev) => {
      const maxNum = prev.length > 0 ? Math.max(...prev.map((t) => t.number)) : 0;
      return [...prev, emptyTier(maxNum + 1)];
    });
    setDirty(true);
  }, []);

  const removeTier = useCallback((index: number) => {
    setTiers((prev) => prev.filter((_, i) => i !== index));
    setDirty(true);
  }, []);

  const resetToDefault = useCallback(() => {
    setTiers(buildDefaultTiers());
    setDirty(true);
  }, []);

  const discardChanges = useCallback(() => {
    setTiers(initialTiers);
    setDirty(false);
  }, [initialTiers]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!currentWorkspaceId) return;
      const tiersMatch =
        JSON.stringify(tiers) === JSON.stringify(buildDefaultTiers());
      const grid: DivisionGrid | null = tiersMatch ? null : { tiers };
      await workspaceService.updateDivisionGrid(currentWorkspaceId, grid);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-workspaces"] });
      fetchWorkspaces();
      setDirty(false);
      toast({ title: "Division grid saved" });
    },
    onError: (e: Error) =>
      toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (!currentWorkspaceId) {
    return (
      <div className="flex flex-col gap-6">
        <AdminPageHeader title="Divisions" description="Select a workspace to manage divisions." />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title="Divisions"
        description={`Division grid for ${workspace?.name ?? "workspace"}. Defines how player rank maps to division tiers.`}
        actions={
          canEdit ? (
            <div className="flex gap-2">
              {dirty && (
                <Button variant="outline" onClick={discardChanges}>
                  Discard
                </Button>
              )}
              <Button variant="outline" onClick={resetToDefault}>
                <RotateCcw className="mr-2 h-4 w-4" />
                Reset to Default
              </Button>
              <Button onClick={() => saveMutation.mutate()} disabled={!dirty || saveMutation.isPending}>
                <Save className="mr-2 h-4 w-4" />
                {saveMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </div>
          ) : null
        }
      />

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">
                {tiers.length} tier{tiers.length !== 1 ? "s" : ""}
              </CardTitle>
              <CardDescription>
                {isCustom ? (
                  <Badge variant="outline" className="mt-1">Custom grid</Badge>
                ) : (
                  <Badge variant="secondary" className="mt-1">Default (20 divisions)</Badge>
                )}
              </CardDescription>
            </div>
            {canEdit && (
              <Button variant="outline" size="sm" onClick={addTier}>
                <Plus className="mr-2 h-3.5 w-3.5" />
                Add Tier
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            {/* Header */}
            <div className="grid grid-cols-[50px_48px_1fr_100px_100px_1fr_40px] gap-2 items-center px-4 py-2 bg-muted/50 text-xs font-medium text-muted-foreground border-b">
              <span>#</span>
              <span>Icon</span>
              <span>Name</span>
              <span>Rank Min</span>
              <span>Rank Max</span>
              <span>Icon Path</span>
              <span />
            </div>

            {/* Rows */}
            {tiers.map((tier, i) => (
              <div
                key={i}
                className="grid grid-cols-[50px_48px_1fr_100px_100px_1fr_40px] gap-2 items-center px-4 py-1.5 border-b last:border-b-0 hover:bg-muted/30 transition-colors"
              >
                {canEdit ? (
                  <Input
                    inputMode="numeric"
                    value={tier.number}
                    onChange={(e) => updateTier(i, "number", parseInt(e.target.value) || 0)}
                    className="h-8 text-sm"
                  />
                ) : (
                  <span className="text-sm font-mono">{tier.number}</span>
                )}

                <div className="flex justify-center">
                  <Image
                    src={tier.icon_path}
                    alt={tier.name}
                    width={28}
                    height={28}
                    className="rounded-full"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                </div>

                {canEdit ? (
                  <Input
                    value={tier.name}
                    onChange={(e) => updateTier(i, "name", e.target.value)}
                    className="h-8 text-sm"
                  />
                ) : (
                  <span className="text-sm">{tier.name}</span>
                )}

                {canEdit ? (
                  <Input
                    inputMode="numeric"
                    value={tier.rank_min}
                    onChange={(e) => updateTier(i, "rank_min", parseInt(e.target.value) || 0)}
                    className="h-8 text-sm"
                  />
                ) : (
                  <span className="text-sm font-mono">{tier.rank_min}</span>
                )}

                {canEdit ? (
                  <Input
                    inputMode="numeric"
                    value={tier.rank_max ?? ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      updateTier(i, "rank_max", val === "" ? null : parseInt(val) || 0);
                    }}
                    placeholder="--"
                    className="h-8 text-sm"
                  />
                ) : (
                  <span className="text-sm font-mono">{tier.rank_max ?? "--"}</span>
                )}

                {canEdit ? (
                  <Input
                    value={tier.icon_path}
                    onChange={(e) => updateTier(i, "icon_path", e.target.value)}
                    className="h-8 text-sm"
                  />
                ) : (
                  <span className="text-sm text-muted-foreground truncate">{tier.icon_path}</span>
                )}

                {canEdit ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive"
                    onClick={() => removeTier(i)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                ) : (
                  <span />
                )}
              </div>
            ))}

            {tiers.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                No tiers configured. Click &quot;Add Tier&quot; or &quot;Reset to Default&quot; to start.
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
