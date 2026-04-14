"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CopyPlus, Plus, Save, Star, Trash2, Upload } from "lucide-react";
import Image from "next/image";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/usePermissions";
import workspaceService from "@/services/workspace.service";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type { DivisionGridVersion, DivisionTier } from "@/types/workspace.types";

function buildDefaultTiers(): DivisionTier[] {
  return Array.from({ length: 20 }, (_, index) => {
    const number = 20 - index;
    return {
      slug: `division-${number}`,
      number,
      name: `Division ${number}`,
      sort_order: index,
      rank_min: number === 1 ? 2000 : index * 100,
      rank_max: number === 1 ? null : index * 100 + 99,
      icon_url: `https://minio.craazzzyyfoxx.me/aqt/assets/divisions/default-${number}.png`
    };
  }).sort((a, b) => a.number - b.number);
}

function emptyTier(number: number, index: number): DivisionTier {
  return {
    slug: `division-${number}`,
    number,
    name: `Division ${number}`,
    sort_order: index,
    rank_min: 0,
    rank_max: 99,
    icon_url: `https://minio.craazzzyyfoxx.me/aqt/assets/divisions/default-${number}.png`
  };
}

function buildEditorState(selectedVersion: DivisionGridVersion | null): {
  label: string;
  tiers: DivisionTier[];
} {
  if (!selectedVersion) {
    return {
      label: "Draft",
      tiers: buildDefaultTiers()
    };
  }

  return {
    label: `${selectedVersion.label} Copy`,
    tiers: [...selectedVersion.tiers]
      .sort((a, b) => a.number - b.number)
      .map((tier, index) => ({ ...tier, sort_order: tier.sort_order ?? index }))
  };
}

type DivisionGridEditorCardProps = {
  workspaceId: number;
  gridId: number;
  canEdit: boolean;
  selectedVersion: DivisionGridVersion | null;
  onSaved: () => Promise<void>;
};

// Navigable column indices: 0=#, 1=name, 2=rank_min, 3=rank_max
const NAV_COLS = 4;

function DivisionGridEditorCard({
  workspaceId,
  gridId,
  canEdit,
  selectedVersion,
  onSaved
}: DivisionGridEditorCardProps) {
  const { toast } = useToast();
  const initialState = useMemo(() => buildEditorState(selectedVersion), [selectedVersion]);
  const [label, setLabel] = useState(initialState.label);
  const [tiers, setTiers] = useState<DivisionTier[]>(initialState.tiers);

  // Keyboard navigation refs: key = `${row}-${col}`
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const setRef = useCallback(
    (row: number, col: number) => (el: HTMLInputElement | null) => {
      const key = `${row}-${col}`;
      if (el) inputRefs.current.set(key, el);
      else inputRefs.current.delete(key);
    },
    []
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>, row: number, col: number) => {
      const input = e.currentTarget;
      const focus = (r: number, c: number) => {
        const target = inputRefs.current.get(`${r}-${c}`);
        if (target) {
          e.preventDefault();
          target.focus();
          target.select();
        }
      };
      switch (e.key) {
        case "ArrowDown":
        case "Enter":
          focus(row + 1, col);
          break;
        case "ArrowUp":
          focus(row - 1, col);
          break;
        case "ArrowLeft":
          if (input.selectionStart === 0 && col > 0) focus(row, col - 1);
          break;
        case "ArrowRight":
          if (input.selectionStart === input.value.length && col < NAV_COLS - 1)
            focus(row, col + 1);
          break;
      }
    },
    []
  );

  const saveVersionMutation = useMutation({
    mutationFn: async () =>
      workspaceService.createDivisionGridVersion(workspaceId, gridId, {
        label,
        tiers: tiers.map((tier, index) => ({
          slug: tier.slug || `division-${tier.number}`,
          number: tier.number,
          name: tier.name,
          sort_order: index,
          rank_min: tier.rank_min,
          rank_max: tier.rank_max,
          icon_url: tier.icon_url
        }))
      }),
    onSuccess: async () => {
      await onSaved();
      toast({ title: "Draft version created" });
    },
    onError: (error: Error) =>
      toast({ title: "Error", description: error.message, variant: "destructive" })
  });

  const updateTier = (index: number, field: keyof DivisionTier, value: string | number | null) => {
    setTiers((current) =>
      current.map((tier, tierIndex) => (tierIndex === index ? { ...tier, [field]: value } : tier))
    );
  };

  const uploadIcon = async (index: number, file: File) => {
    const tier = tiers[index];
    const slugBase = tier.slug || `division-${tier.number}`;
    const randomHash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
    const upload = await workspaceService.uploadDivisionIcon(
      `${slugBase}-${randomHash}`,
      file,
      workspaceId
    );
    updateTier(index, "icon_url", upload.public_url);
    toast({ title: "Icon uploaded" });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Draft Editor</CardTitle>
        <CardDescription>Create a new immutable version from the current tier set.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Version label"
        />

        <div className="rounded-md border">
          <div className="grid grid-cols-[56px_48px_200px_1fr_40px_36px] gap-2 border-b bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground">
            <span>#</span>
            <span>Icon</span>
            <span>Name</span>
            <span>Rank Range</span>
            <span>Upload</span>
            <span />
          </div>
          {tiers.map((tier, rowIndex) => (
            <div
              key={`${tier.slug ?? tier.number}-${rowIndex}`}
              className="grid grid-cols-[56px_48px_200px_1fr_40px_36px] gap-2 border-b px-4 py-1.5 last:border-b-0"
            >
              {/* # */}
              <Input
                ref={setRef(rowIndex, 0)}
                inputMode="numeric"
                className="h-8 text-center tabular-nums"
                value={tier.number}
                onChange={(e) =>
                  updateTier(rowIndex, "number", Number.parseInt(e.target.value, 10) || 0)
                }
                onKeyDown={(e) => handleKeyDown(e, rowIndex, 0)}
              />
              {/* Icon */}
              <div className="flex items-center justify-center">
                <Image src={tier.icon_url} alt={tier.name} width={28} height={28} />
              </div>
              {/* Name */}
              <Input
                ref={setRef(rowIndex, 1)}
                className="h-8"
                value={tier.name}
                onChange={(e) => updateTier(rowIndex, "name", e.target.value)}
                onKeyDown={(e) => handleKeyDown(e, rowIndex, 1)}
              />
              {/* Rank range: min — max */}
              <div className="flex items-center gap-1.5">
                <Input
                  ref={setRef(rowIndex, 2)}
                  inputMode="numeric"
                  className="h-8 w-24 tabular-nums"
                  value={tier.rank_min}
                  onChange={(e) =>
                    updateTier(rowIndex, "rank_min", Number.parseInt(e.target.value, 10) || 0)
                  }
                  onKeyDown={(e) => handleKeyDown(e, rowIndex, 2)}
                />
                <span className="shrink-0 text-xs text-muted-foreground">—</span>
                <Input
                  ref={setRef(rowIndex, 3)}
                  inputMode="numeric"
                  className="h-8 w-24 tabular-nums"
                  placeholder="∞"
                  value={tier.rank_max ?? ""}
                  onChange={(e) =>
                    updateTier(
                      rowIndex,
                      "rank_max",
                      e.target.value === "" ? null : Number.parseInt(e.target.value, 10) || 0
                    )
                  }
                  onKeyDown={(e) => handleKeyDown(e, rowIndex, 3)}
                />
              </div>
              {/* Upload */}
              <label className="inline-flex cursor-pointer items-center justify-center">
                <input
                  type="file"
                  className="hidden"
                  accept="image/png,image/webp,image/jpeg,image/gif"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void uploadIcon(rowIndex, file);
                  }}
                />
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-md border hover:bg-muted">
                  <Upload className="h-3.5 w-3.5" />
                </span>
              </label>
              {/* Delete */}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setTiers((current) => current.filter((_, i) => i !== rowIndex))}
              >
                ×
              </Button>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() =>
              setTiers((current) => [
                ...current,
                emptyTier((Math.max(...current.map((t) => t.number)) || 0) + 1, current.length)
              ])
            }
            disabled={!canEdit}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Tier
          </Button>
          <Button
            onClick={() => saveVersionMutation.mutate()}
            disabled={!canEdit || saveVersionMutation.isPending}
          >
            <Save className="mr-2 h-4 w-4" />
            Save New Version
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function DivisionsAdminPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isSuperuser, isWorkspaceAdmin } = usePermissions();
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const getCurrentWorkspace = useWorkspaceStore((s) => s.getCurrentWorkspace);
  const fetchWorkspaces = useWorkspaceStore((s) => s.fetchWorkspaces);
  const workspace = getCurrentWorkspace();

  const canEdit =
    isSuperuser || (currentWorkspaceId !== null && isWorkspaceAdmin(currentWorkspaceId));

  const gridsQuery = useQuery({
    queryKey: ["division-grids", currentWorkspaceId],
    queryFn: () => workspaceService.getDivisionGrids(currentWorkspaceId!),
    enabled: currentWorkspaceId !== null
  });

  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);

  const grids = gridsQuery.data ?? [];
  const activeGrid = grids[0] ?? null;
  const versions = activeGrid?.versions ?? [];

  const defaultVersionId = useMemo(() => {
    if (!workspace || versions.length === 0) return null;
    return (
      (
        versions.find((v) => v.id === workspace.default_division_grid_version_id) ??
        versions.find((v) => v.status === "published") ??
        versions[versions.length - 1] ??
        null
      )?.id ?? null
    );
  }, [versions, workspace]);

  const effectiveVersionId = selectedVersionId ?? defaultVersionId;
  const selectedVersion = versions.find((v) => v.id === effectiveVersionId) ?? null;

  const createGridMutation = useMutation({
    mutationFn: async () => {
      if (!currentWorkspaceId) return null;
      return workspaceService.createDivisionGrid(currentWorkspaceId, {
        slug: "default",
        name: `${workspace?.name ?? "Workspace"} Division Grid`
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["division-grids", currentWorkspaceId] });
      toast({ title: "Division grid created" });
    },
    onError: (error: Error) =>
      toast({ title: "Error", description: error.message, variant: "destructive" })
  });

  const cloneMutation = useMutation({
    mutationFn: async () => {
      if (!selectedVersion) return null;
      return workspaceService.cloneDivisionGridVersion(selectedVersion.id);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["division-grids", currentWorkspaceId] });
      toast({ title: "Version cloned" });
    },
    onError: (error: Error) =>
      toast({ title: "Error", description: error.message, variant: "destructive" })
  });

  const publishMutation = useMutation({
    mutationFn: async () => {
      if (!selectedVersion) return null;
      return workspaceService.publishDivisionGridVersion(selectedVersion.id);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["division-grids", currentWorkspaceId] });
      toast({ title: "Version published" });
    },
    onError: (error: Error) =>
      toast({ title: "Error", description: error.message, variant: "destructive" })
  });

  const deleteVersionMutation = useMutation({
    mutationFn: (versionId: number) => workspaceService.deleteDivisionGridVersion(versionId),
    onSuccess: async (_, versionId) => {
      if (selectedVersionId === versionId) setSelectedVersionId(null);
      await queryClient.invalidateQueries({ queryKey: ["division-grids", currentWorkspaceId] });
      toast({ title: "Version deleted" });
    },
    onError: (error: Error) =>
      toast({ title: "Cannot delete", description: error.message, variant: "destructive" })
  });

  const setDefaultMutation = useMutation({
    mutationFn: async () => {
      if (!workspace || !selectedVersion) return null;
      return workspaceService.update(workspace.id, {
        default_division_grid_version_id: selectedVersion.id
      });
    },
    onSuccess: async () => {
      await fetchWorkspaces();
      toast({ title: "Workspace default updated" });
    },
    onError: (error: Error) =>
      toast({ title: "Error", description: error.message, variant: "destructive" })
  });

  if (!currentWorkspaceId) {
    return (
      <AdminPageHeader
        title="Divisions"
        description="Select a workspace to manage division grids."
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title="Divisions"
        description="Manage workspace division grids, versions, and tier icons."
        actions={
          canEdit ? (
            <div className="flex gap-2">
              {!activeGrid && (
                <Button
                  onClick={() => createGridMutation.mutate()}
                  disabled={createGridMutation.isPending}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Create Grid
                </Button>
              )}
              {selectedVersion && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => cloneMutation.mutate()}
                    disabled={cloneMutation.isPending}
                  >
                    <CopyPlus className="mr-2 h-4 w-4" />
                    Clone Version
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => publishMutation.mutate()}
                    disabled={publishMutation.isPending}
                  >
                    Publish
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setDefaultMutation.mutate()}
                    disabled={setDefaultMutation.isPending}
                  >
                    <Star className="mr-2 h-4 w-4" />
                    Set Default
                  </Button>
                </>
              )}
            </div>
          ) : null
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Grid Status</CardTitle>
          <CardDescription>
            {activeGrid ? (
              <>
                Grid <span className="font-medium">{activeGrid.name}</span> with {versions.length}{" "}
                version(s).
              </>
            ) : (
              "No division grid created for this workspace yet."
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-4">
          {versions.length > 0 ? (
            <>
              <Select
                value={effectiveVersionId?.toString() ?? ""}
                onValueChange={(value) => setSelectedVersionId(Number(value))}
              >
                <SelectTrigger className="w-90">
                  <SelectValue placeholder="Select version" />
                </SelectTrigger>
                <SelectContent>
                  {versions
                    .slice()
                    .sort((a, b) => b.version - a.version)
                    .map((version) => (
                      <SelectItem key={version.id} value={version.id.toString()}>
                        <span className="flex items-center gap-2">
                          v{version.version} — {version.label}
                          {version.status === "published" && (
                            <Badge variant="default" className="ml-1 text-[10px] px-1.5 py-0">
                              published
                            </Badge>
                          )}
                          {workspace?.default_division_grid_version_id === version.id && (
                            <Star className="h-3 w-3 text-yellow-500" />
                          )}
                        </span>
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {selectedVersion && (
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">Version {selectedVersion.version}</Badge>
                  <Badge variant={selectedVersion.status === "published" ? "default" : "secondary"}>
                    {selectedVersion.status}
                  </Badge>
                  {workspace?.default_division_grid_version_id === selectedVersion.id && (
                    <Badge variant="secondary">Workspace Default</Badge>
                  )}
                </div>
              )}
            </>
          ) : (
            <span className="text-sm text-muted-foreground">
              Create a grid to start versioning.
            </span>
          )}
        </CardContent>
      </Card>

      {activeGrid && (
        <DivisionGridEditorCard
          key={selectedVersion?.id ?? "default-grid-editor"}
          workspaceId={currentWorkspaceId}
          gridId={activeGrid.id}
          canEdit={canEdit}
          selectedVersion={selectedVersion}
          onSaved={async () => {
            await queryClient.invalidateQueries({
              queryKey: ["division-grids", currentWorkspaceId]
            });
          }}
        />
      )}

      {versions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Versions</CardTitle>
            <CardDescription>
              Published and draft versions available in this workspace grid.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {versions
              .slice()
              .sort((a, b) => b.version - a.version)
              .map((version) => {
                const isSelected = version.id === effectiveVersionId;
                const isDefault = workspace?.default_division_grid_version_id === version.id;
                const isDeleting =
                  deleteVersionMutation.isPending && deleteVersionMutation.variables === version.id;
                return (
                  <div
                    key={version.id}
                    role="button"
                    tabIndex={0}
                    className={`flex w-full cursor-pointer items-center justify-between rounded-lg border p-3 text-left transition-colors ${
                      isSelected
                        ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                        : "hover:bg-muted/50"
                    }`}
                    onClick={() => setSelectedVersionId(version.id)}
                    onKeyDown={(e) => e.key === "Enter" && setSelectedVersionId(version.id)}
                  >
                    <div>
                      <div className="flex items-center gap-2 font-medium">
                        {version.label}
                        {isSelected && <Check className="h-4 w-4 text-primary" />}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        Version {version.version} • {version.tiers.length} tiers
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={version.status === "published" ? "default" : "secondary"}>
                        {version.status}
                      </Badge>
                      {isDefault && <Badge variant="outline">Default</Badge>}
                      {canEdit && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          disabled={isDeleting}
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteVersionMutation.mutate(version.id);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
