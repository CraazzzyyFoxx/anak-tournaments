"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Archive,
  Check,
  Download,
  FileJson,
  FolderOpen,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Search,
  Star,
  Upload,
  X
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { notify } from "@/lib/notify";
import workspaceService from "@/services/workspace.service";
import type { DivisionGridEntity, DivisionGridPortableDocument } from "@/types/workspace.types";

interface GridLibraryPermissions {
  create: boolean;
  update: boolean;
  delete: boolean;
  import: boolean;
  export: boolean;
}

interface Props {
  workspaceId: number;
  workspaceName: string;
  defaultVersionId: number | null;
  grids: DivisionGridEntity[];
  selectedGridId: number | null;
  permissions: GridLibraryPermissions;
  loading: boolean;
  error: unknown;
  onSelect: (gridId: number, versionId?: number) => void;
  onChanged: () => Promise<void>;
}

export function DivisionGridLibrary({
  workspaceId,
  workspaceName,
  defaultVersionId,
  grids,
  selectedGridId,
  permissions,
  loading,
  error,
  onSelect,
  onChanged
}: Props) {
  const portableInputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [editingGridId, setEditingGridId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");

  const activeGrid =
    grids.find((grid) => grid.versions.some((version) => version.id === defaultVersionId)) ?? null;
  const activeVersion =
    activeGrid?.versions.find((version) => version.id === defaultVersionId) ?? null;
  const visibleGrids = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase();
    return grids.filter((grid) => {
      if (!showArchived && grid.archived_at) return false;
      if (!normalized) return true;
      return `${grid.name} ${grid.slug}`.toLocaleLowerCase().includes(normalized);
    });
  }, [grids, search, showArchived]);

  const createMutation = useMutation({
    mutationFn: () =>
      workspaceService.createDivisionGrid(workspaceId, {
        slug: `grid-${Date.now()}`,
        name: `${workspaceName} Division Grid`
      }),
    onSuccess: async (grid) => {
      await onChanged();
      onSelect(grid.id, grid.versions[0]?.id);
      notify.success("Division grid created");
    },
    onError: (mutationError) =>
      notify.error("Grid could not be created", {
        description:
          mutationError instanceof Error
            ? mutationError.message
            : "The division grid operation failed."
      })
  });
  const updateMutation = useMutation({
    mutationFn: ({
      gridId,
      data
    }: {
      gridId: number;
      data: { name?: string; archived?: boolean };
    }) => workspaceService.updateDivisionGrid(gridId, data),
    onSuccess: async () => {
      setEditingGridId(null);
      await onChanged();
    },
    onError: (mutationError) =>
      notify.error("Grid could not be updated", {
        description:
          mutationError instanceof Error
            ? mutationError.message
            : "The division grid operation failed."
      })
  });
  const portableImportMutation = useMutation({
    mutationFn: (document: DivisionGridPortableDocument) =>
      workspaceService.importDivisionGridPortable(workspaceId, document),
    onSuccess: async (grid) => {
      await onChanged();
      onSelect(grid.id, grid.versions[0]?.id);
      notify.success("Portable division grid imported");
    },
    onError: (mutationError) =>
      notify.error("Portable import failed", {
        description:
          mutationError instanceof Error
            ? mutationError.message
            : "The division grid operation failed."
      })
  });

  const exportPortable = async (grid: DivisionGridEntity) => {
    try {
      const document = await workspaceService.exportDivisionGridPortable(grid.id);
      const blob = new Blob([JSON.stringify(document, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = `${grid.slug}.division-grid.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      notify.error("Portable export failed", {
        description:
          exportError instanceof Error ? exportError.message : "The division grid operation failed."
      });
    }
  };

  const importPortable = async (file: File) => {
    try {
      const document = JSON.parse(await file.text()) as DivisionGridPortableDocument;
      portableImportMutation.mutate(document);
    } catch (parseError) {
      notify.error("Invalid division grid JSON", {
        description:
          parseError instanceof Error ? parseError.message : "The selected file is not valid JSON."
      });
    } finally {
      if (portableInputRef.current) portableInputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary/10 via-background to-background">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <CardDescription>Active interpretation</CardDescription>
              <CardTitle className="mt-1 text-2xl">
                {activeGrid ? activeGrid.name : "No active division grid"}
              </CardTitle>
            </div>
            {activeVersion && (
              <Badge className="gap-1">
                <Star className="h-3 w-3" /> v{activeVersion.version} active
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {activeVersion ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border bg-background/70 p-3">
                <div className="text-xs text-muted-foreground">Published version</div>
                <div className="mt-1 font-medium">{activeVersion.label}</div>
              </div>
              <div className="rounded-lg border bg-background/70 p-3">
                <div className="text-xs text-muted-foreground">Tier definitions</div>
                <div className="mt-1 font-medium">{activeVersion.tiers.length}</div>
              </div>
              <div className="rounded-lg border bg-background/70 p-3">
                <div className="text-xs text-muted-foreground">Library source</div>
                <div className="mt-1 font-medium">
                  {activeGrid?.source_workspace_id ? "Imported" : "Local"}
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed bg-background/60 p-4 text-sm text-muted-foreground">
              Publish and activate a version after its mappings are ready. Existing tournaments
              remain pinned to their historical versions.
            </div>
          )}
        </CardContent>
      </Card>

      <Card id="library">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FolderOpen className="h-4 w-4" /> Grid library
              </CardTitle>
              <CardDescription className="mt-1">
                Local, imported, template, and archived grids. Selecting a grid updates the deep
                link.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              {permissions.import && (
                <>
                  <input
                    ref={portableInputRef}
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void importPortable(file);
                    }}
                  />
                  <Button
                    variant="outline"
                    onClick={() => portableInputRef.current?.click()}
                    disabled={portableImportMutation.isPending}
                  >
                    <Upload className="mr-2 h-4 w-4" /> Import JSON
                  </Button>
                </>
              )}
              {permissions.create && (
                <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
                  <Plus className="mr-2 h-4 w-4" /> New grid
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative min-w-64 flex-1">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search library"
                className="pl-9"
              />
            </label>
            <Button
              variant={showArchived ? "secondary" : "outline"}
              onClick={() => setShowArchived((value) => !value)}
            >
              <Archive className="mr-2 h-4 w-4" />{" "}
              {showArchived ? "Hide archived" : "Show archived"}
            </Button>
          </div>

          {error !== null && error !== undefined && (
            <Alert variant="destructive">
              <AlertTitle>Grid library unavailable</AlertTitle>
              <AlertDescription>
                {error instanceof Error ? error.message : "The grid library could not be loaded."}
              </AlertDescription>
            </Alert>
          )}
          {loading ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Loading grid library…
            </div>
          ) : visibleGrids.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              No grids match this library view.
            </div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {visibleGrids.map((grid) => {
                const selected = grid.id === selectedGridId;
                const imported = grid.source_workspace_id !== null;
                const isActive = grid.id === activeGrid?.id;
                return (
                  <div
                    key={grid.id}
                    className={`rounded-xl border p-4 transition-colors ${selected ? "border-primary bg-primary/5 ring-1 ring-primary/20" : "hover:bg-muted/30"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => onSelect(grid.id, grid.versions.at(-1)?.id)}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          {editingGridId === grid.id ? (
                            <Input
                              value={editingName}
                              onChange={(event) => setEditingName(event.target.value)}
                              onClick={(event) => event.stopPropagation()}
                              aria-label="Grid name"
                            />
                          ) : (
                            <span className="truncate font-semibold">{grid.name}</span>
                          )}
                          {isActive && <Badge>Active</Badge>}
                          {grid.archived_at && <Badge variant="secondary">Archived</Badge>}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {grid.slug} · {grid.versions.length} version(s)
                        </div>
                        <div className="mt-3 flex flex-wrap gap-1">
                          <Badge variant="outline">{imported ? "Imported" : "Local"}</Badge>
                          {grid.imported_at && (
                            <Badge variant="outline">
                              {new Date(grid.imported_at).toLocaleDateString()}
                            </Badge>
                          )}
                        </div>
                      </button>
                      {selected && <Check className="h-4 w-4 text-primary" />}
                    </div>
                    <div className="mt-4 flex flex-wrap gap-1 border-t pt-3">
                      {permissions.update &&
                        !grid.archived_at &&
                        (editingGridId === grid.id ? (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                updateMutation.mutate({
                                  gridId: grid.id,
                                  data: { name: editingName.trim() }
                                })
                              }
                              disabled={!editingName.trim()}
                            >
                              <Save className="mr-1 h-3.5 w-3.5" /> Save
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditingGridId(null)}
                            >
                              <X className="mr-1 h-3.5 w-3.5" /> Cancel
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditingGridId(grid.id);
                              setEditingName(grid.name);
                            }}
                          >
                            <Pencil className="mr-1 h-3.5 w-3.5" /> Rename
                          </Button>
                        ))}
                      {permissions.export && (
                        <Button size="sm" variant="ghost" onClick={() => void exportPortable(grid)}>
                          <FileJson className="mr-1 h-3.5 w-3.5" /> Export
                        </Button>
                      )}
                      {permissions.update && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            updateMutation.mutate({
                              gridId: grid.id,
                              data: { archived: !grid.archived_at }
                            })
                          }
                          disabled={isActive}
                        >
                          {grid.archived_at ? (
                            <RotateCcw className="mr-1 h-3.5 w-3.5" />
                          ) : (
                            <Archive className="mr-1 h-3.5 w-3.5" />
                          )}
                          {grid.archived_at ? "Restore" : "Archive"}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onSelect(grid.id, grid.versions.at(-1)?.id)}
                      >
                        <Download className="mr-1 h-3.5 w-3.5" /> Open
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
