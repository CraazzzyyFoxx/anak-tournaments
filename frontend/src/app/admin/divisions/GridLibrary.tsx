"use client";

import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Archive,
  Download,
  FolderOpen,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  Upload,
  X
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { notify } from "@/lib/notify";
import { ApiError } from "@/lib/api-error";
import workspaceService from "@/services/workspace.service";
import type { DivisionGridEntity, DivisionGridPortableDocument } from "@/types/workspace.types";

interface GridLibraryPermissions {
  create: boolean;
  update: boolean;
  import: boolean;
  export: boolean;
  delete: boolean;
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
  const [editingName, setEditingName] = useState<string | null>(null);
  const [forceDeleteOpen, setForceDeleteOpen] = useState(false);
  const activeGrid = grids.find((grid) =>
    grid.versions.some((version) => version.id === defaultVersionId)
  );
  const selectedGrid =
    grids.find((grid) => grid.id === selectedGridId) ?? activeGrid ?? grids[0] ?? null;
  const activeVersion =
    activeGrid?.versions.find((version) => version.id === defaultVersionId) ?? null;
  const visibleGrids = grids.filter(
    (grid) => grid.archived_at === null || grid.id === selectedGrid?.id
  );

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
    onError: showMutationError("Grid could not be created")
  });
  const updateMutation = useMutation({
    mutationFn: (data: { name?: string; archived?: boolean }) => {
      if (!selectedGrid) throw new Error("Choose a division grid first.");
      return workspaceService.updateDivisionGrid(selectedGrid.id, data);
    },
    onSuccess: async () => {
      setEditingName(null);
      await onChanged();
    },
    onError: showMutationError("Grid could not be updated")
  });
  const deleteMutation = useMutation({
    mutationFn: (force: boolean) => {
      if (!selectedGrid) throw new Error("Choose a division grid first.");
      return workspaceService.deleteDivisionGrid(selectedGrid.id, force);
    },
    onSuccess: async () => {
      setForceDeleteOpen(false);
      await onChanged();
      notify.success("Division grid deleted");
    },
    onError: (error) => {
      // 409 = default/in-use guard; offer a force-delete confirmation instead.
      if (error instanceof ApiError && error.status === 409) {
        setForceDeleteOpen(true);
        return;
      }
      showMutationError("Grid could not be deleted")(error);
    }
  });
  const portableImportMutation = useMutation({
    mutationFn: (document: DivisionGridPortableDocument) =>
      workspaceService.importDivisionGridPortable(workspaceId, document),
    onSuccess: async (grid) => {
      await onChanged();
      onSelect(grid.id, grid.versions[0]?.id);
      notify.success("Portable division grid imported");
    },
    onError: showMutationError("Portable import failed")
  });

  const exportPortable = async () => {
    if (!selectedGrid) return;
    try {
      const document = await workspaceService.exportDivisionGridPortable(selectedGrid.id);
      const blob = new Blob([JSON.stringify(document, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = `${selectedGrid.slug}.division-grid.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      showMutationError("Portable export failed")(exportError);
    }
  };

  const importPortable = async (file: File) => {
    try {
      portableImportMutation.mutate(JSON.parse(await file.text()) as DivisionGridPortableDocument);
    } catch (parseError) {
      notify.error("Invalid division grid JSON", {
        description:
          parseError instanceof Error ? parseError.message : "The file is not valid JSON."
      });
    } finally {
      if (portableInputRef.current) portableInputRef.current.value = "";
    }
  };

  return (
    <Card id="library">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardDescription>Active division grid</CardDescription>
            <CardTitle className="mt-1 flex flex-wrap items-center gap-2">
              {activeGrid?.name ?? "No active division grid"}
              {activeVersion && <Badge>v{activeVersion.version} active</Badge>}
            </CardTitle>
            <CardDescription className="mt-1">
              {activeVersion
                ? `${activeVersion.label} · ${activeVersion.tiers.length} tiers`
                : "Publish and activate a version to use it for rank interpretation."}
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
        {error !== null && error !== undefined && (
          <Alert variant="destructive">
            <AlertTitle>Division grids unavailable</AlertTitle>
            <AlertDescription>
              {error instanceof Error ? error.message : "Division grids could not be loaded."}
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <label className="grid gap-2 text-sm font-medium">
            Grid
            <Select
              value={selectedGrid?.id.toString() ?? ""}
              onValueChange={(value) => {
                const grid = grids.find((candidate) => candidate.id === Number(value));
                if (grid) onSelect(grid.id, grid.versions.at(-1)?.id);
              }}
              disabled={loading || visibleGrids.length === 0}
            >
              <SelectTrigger>
                <SelectValue placeholder={loading ? "Loading…" : "Choose grid"} />
              </SelectTrigger>
              <SelectContent>
                {visibleGrids.map((grid) => (
                  <SelectItem key={grid.id} value={grid.id.toString()}>
                    {grid.name} · {grid.versions.length} version(s)
                    {grid.archived_at ? " · archived" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <Button
            variant="outline"
            disabled={!selectedGrid}
            onClick={() => {
              if (selectedGrid) onSelect(selectedGrid.id, selectedGrid.versions.at(-1)?.id);
            }}
          >
            <FolderOpen className="mr-2 h-4 w-4" /> Open
          </Button>
        </div>

        {selectedGrid && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 p-3">
            <div className="min-w-0">
              {editingName === null ? (
                <div className="truncate font-medium">{selectedGrid.name}</div>
              ) : (
                <Input
                  aria-label="Grid name"
                  value={editingName}
                  onChange={(event) => setEditingName(event.target.value)}
                  className="max-w-sm"
                />
              )}
              <div className="mt-1 text-xs text-muted-foreground">
                {selectedGrid.slug} · {selectedGrid.versions.length} version(s)
                {selectedGrid.archived_at ? " · archived" : ""}
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              {permissions.update &&
                (editingName === null ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditingName(selectedGrid.name)}
                  >
                    <Pencil className="mr-2 h-4 w-4" /> Rename
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => updateMutation.mutate({ name: editingName.trim() })}
                      disabled={!editingName.trim() || updateMutation.isPending}
                    >
                      <Save className="mr-2 h-4 w-4" /> Save
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setEditingName(null)}>
                      <X className="mr-2 h-4 w-4" /> Cancel
                    </Button>
                  </>
                ))}
              {permissions.export && (
                <Button variant="ghost" size="sm" onClick={() => void exportPortable()}>
                  <Download className="mr-2 h-4 w-4" /> Export
                </Button>
              )}
              {permissions.update && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => updateMutation.mutate({ archived: !selectedGrid.archived_at })}
                  disabled={updateMutation.isPending}
                >
                  {selectedGrid.archived_at ? (
                    <RotateCcw className="mr-2 h-4 w-4" />
                  ) : (
                    <Archive className="mr-2 h-4 w-4" />
                  )}
                  {selectedGrid.archived_at ? "Restore" : "Archive"}
                </Button>
              )}
              {permissions.delete && (
                <>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="mr-2 h-4 w-4" /> Delete
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete “{selectedGrid.name}”?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Permanently removes the grid and all its versions, tiers, and mappings.
                          If it is the workspace default or used by tournaments, you will be asked to
                          confirm a force delete.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => deleteMutation.mutate(false)}>
                          Delete grid
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>

                  <AlertDialog open={forceDeleteOpen} onOpenChange={setForceDeleteOpen}>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Force delete “{selectedGrid.name}”?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This grid is the workspace default or still used by tournaments. Force
                          deleting will unset it as the workspace default and detach affected
                          tournaments — their division data will be cleared. This cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          onClick={() => deleteMutation.mutate(true)}
                        >
                          Force delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function showMutationError(title: string) {
  return (error: unknown) =>
    notify.error(title, {
      description: error instanceof Error ? error.message : "The division grid operation failed."
    });
}
