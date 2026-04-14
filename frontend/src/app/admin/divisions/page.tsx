"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, CopyPlus, Plus, Save, Star, Upload } from "lucide-react";
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
import type {
  DivisionGridEntity,
  DivisionGridVersion,
  DivisionTier
} from "@/types/workspace.types";

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
          <div className="grid grid-cols-[60px_52px_1fr_110px_110px_1.2fr_100px_40px] gap-2 border-b bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground">
            <span>#</span>
            <span>Icon</span>
            <span>Name</span>
            <span>Rank Min</span>
            <span>Rank Max</span>
            <span>Icon URL</span>
            <span>Upload</span>
            <span />
          </div>
          {tiers.map((tier, index) => (
            <div
              key={`${tier.slug ?? tier.number}-${index}`}
              className="grid grid-cols-[60px_52px_1fr_110px_110px_1.2fr_100px_40px] gap-2 border-b px-4 py-2 last:border-b-0"
            >
              <Input
                inputMode="numeric"
                value={tier.number}
                onChange={(event) =>
                  updateTier(index, "number", Number.parseInt(event.target.value, 10) || 0)
                }
              />
              <div className="flex items-center justify-center">
                <Image src={tier.icon_url} alt={tier.name} width={32} height={32} />
              </div>
              <Input
                value={tier.name}
                onChange={(event) => updateTier(index, "name", event.target.value)}
              />
              <Input
                inputMode="numeric"
                value={tier.rank_min}
                onChange={(event) =>
                  updateTier(index, "rank_min", Number.parseInt(event.target.value, 10) || 0)
                }
              />
              <Input
                inputMode="numeric"
                value={tier.rank_max ?? ""}
                onChange={(event) =>
                  updateTier(
                    index,
                    "rank_max",
                    event.target.value === "" ? null : Number.parseInt(event.target.value, 10) || 0
                  )
                }
              />
              <Input
                value={tier.icon_url}
                onChange={(event) => updateTier(index, "icon_url", event.target.value)}
              />
              <label className="inline-flex cursor-pointer items-center justify-center">
                <input
                  type="file"
                  className="hidden"
                  accept="image/png,image/webp,image/jpeg,image/gif"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      void uploadIcon(index, file);
                    }
                  }}
                />
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-md border">
                  <Upload className="h-4 w-4" />
                </span>
              </label>
              <Button
                variant="ghost"
                size="icon"
                onClick={() =>
                  setTiers((current) => current.filter((_, currentIndex) => currentIndex !== index))
                }
              >
                x
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
                emptyTier(
                  (Math.max(...current.map((tier) => tier.number)) || 0) + 1,
                  current.length
                )
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
                return (
                  <button
                    key={version.id}
                    type="button"
                    className={`flex w-full items-center justify-between rounded-lg border p-3 text-left transition-colors ${
                      isSelected
                        ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                        : "hover:bg-muted/50"
                    }`}
                    onClick={() => setSelectedVersionId(version.id)}
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
                      {workspace?.default_division_grid_version_id === version.id && (
                        <Badge variant="outline">Default</Badge>
                      )}
                    </div>
                  </button>
                );
              })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
