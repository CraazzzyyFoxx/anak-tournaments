"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Download, LoaderCircle } from "lucide-react";

import { TONE_TEXT } from "@/components/admin/tone";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { notify } from "@/lib/notify";
import workspaceService from "@/services/workspace.service";
import type {
  DivisionGridImportJob,
  DivisionGridMarketplaceImportRequest
} from "@/types/workspace.types";

interface Props {
  workspaceId: number;
  canImport: boolean;
  onImported: (job: DivisionGridImportJob) => Promise<void> | void;
}

export function DivisionGridImportWizard({ workspaceId, canImport, onImported }: Readonly<Props>) {
  const fieldId = useId();
  const workspaceFieldId = `${fieldId}-workspace`;
  const gridFieldId = `${fieldId}-grid`;
  const versionFieldId = `${fieldId}-version`;
  const mappingsFieldId = `${fieldId}-mappings`;
  const iconsFieldId = `${fieldId}-icons`;
  const [sourceWorkspaceId, setSourceWorkspaceId] = useState<number | null>(null);
  const [sourceGridId, setSourceGridId] = useState<number | null>(null);
  const [sourceVersionId, setSourceVersionId] = useState<number | null>(null);
  const [includeOwRankMappings, setIncludeOwRankMappings] = useState(true);
  const [includeIcons, setIncludeIcons] = useState(true);
  const [activeJobId, setActiveJobId] = useState<number | null>(null);
  const reportedJobIdRef = useRef<number | null>(null);

  const workspacesQuery = useQuery({
    queryKey: ["division-grid-import-workspaces", workspaceId],
    queryFn: () => workspaceService.getDivisionGridMarketplaceWorkspaces(workspaceId),
    enabled: canImport
  });
  const gridsQuery = useQuery({
    queryKey: ["division-grid-import-grids", workspaceId, sourceWorkspaceId],
    queryFn: () => workspaceService.getDivisionGridMarketplace(workspaceId, sourceWorkspaceId!),
    enabled: canImport && sourceWorkspaceId !== null
  });
  const jobQuery = useQuery({
    queryKey: ["division-grid-import-job", workspaceId, activeJobId],
    queryFn: () => workspaceService.getDivisionGridImportJob(workspaceId, activeJobId!),
    enabled: activeJobId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "pending" || status === "running" ? 1000 : false;
    }
  });

  const selectedGrid = (gridsQuery.data ?? []).find((grid) => grid.id === sourceGridId) ?? null;
  const request = useMemo<DivisionGridMarketplaceImportRequest | null>(() => {
    if (sourceWorkspaceId === null || sourceGridId === null || sourceVersionId === null)
      return null;
    return {
      source_workspace_id: sourceWorkspaceId,
      source_grid_id: sourceGridId,
      source_version_id: sourceVersionId,
      include_icons: includeIcons,
      include_ow_rank_mappings: includeOwRankMappings
    };
  }, [includeIcons, includeOwRankMappings, sourceGridId, sourceVersionId, sourceWorkspaceId]);

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!request) throw new Error("Choose a workspace, grid, and version.");
      return workspaceService.importDivisionGridMarketplace(workspaceId, request);
    },
    onSuccess: (job) => {
      reportedJobIdRef.current = null;
      setActiveJobId(job.id);
    },
    onError: (error) =>
      notify.error("Import could not start", {
        description: `The version was not copied, so nothing changed in this workspace. ${
          error instanceof Error ? error.message : "The import request failed."
        } Re-check the workspace, grid and version, then try again.`
      })
  });

  useEffect(() => {
    const job = jobQuery.data;
    if (!job || job.status !== "completed" || reportedJobIdRef.current === job.id) return;
    reportedJobIdRef.current = job.id;
    void onImported(job);
    notify.success("Division grid version imported");
  }, [jobQuery.data, onImported]);

  if (!canImport) return null;

  const job = jobQuery.data;
  const isRunning = job?.status === "pending" || job?.status === "running";
  const reset = () => {
    setSourceWorkspaceId(null);
    setSourceGridId(null);
    setSourceVersionId(null);
    setActiveJobId(null);
    reportedJobIdRef.current = null;
  };

  return (
    <Card id="import">
      <CardHeader>
        <CardTitle asChild>
          <h2>Import one version</h2>
        </CardTitle>
        <CardDescription>
          Copy a specific division-grid version from another workspace. The imported version is not
          activated automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {workspacesQuery.isError && (
          <Alert variant="destructive">
            <AlertCircle aria-hidden className="h-4 w-4" />
            <AlertTitle>Workspaces could not be loaded</AlertTitle>
            <AlertDescription>
              Reload the page to try again.{" "}
              {workspacesQuery.error instanceof Error
                ? workspacesQuery.error.message
                : "The workspace list is unavailable."}
            </AlertDescription>
          </Alert>
        )}

        {!workspacesQuery.isLoading &&
          !workspacesQuery.isError &&
          (workspacesQuery.data ?? []).length === 0 && (
            <p className="rounded-lg border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
              No other workspace exposes a division grid you can import. Ask a workspace owner to
              publish one, or build a grid from scratch instead.
            </p>
          )}

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor={workspaceFieldId}>
              Source workspace
            </label>
            <Select
              value={sourceWorkspaceId?.toString() ?? ""}
              onValueChange={(value) => {
                setSourceWorkspaceId(Number(value));
                setSourceGridId(null);
                setSourceVersionId(null);
              }}
              disabled={isRunning}
            >
              <SelectTrigger id={workspaceFieldId}>
                <SelectValue
                  placeholder={workspacesQuery.isLoading ? "Loading…" : "Choose workspace"}
                />
              </SelectTrigger>
              <SelectContent>
                {(workspacesQuery.data ?? []).map((workspace) => (
                  <SelectItem key={workspace.id} value={workspace.id.toString()}>
                    {workspace.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor={gridFieldId}>
              Division grid
            </label>
            <Select
              value={sourceGridId?.toString() ?? ""}
              onValueChange={(value) => {
                setSourceGridId(Number(value));
                setSourceVersionId(null);
              }}
              disabled={sourceWorkspaceId === null || gridsQuery.isLoading || isRunning}
            >
              <SelectTrigger id={gridFieldId}>
                <SelectValue placeholder={gridsQuery.isLoading ? "Loading…" : "Choose grid"} />
              </SelectTrigger>
              <SelectContent>
                {(gridsQuery.data ?? []).map((grid) => (
                  <SelectItem key={grid.id} value={grid.id.toString()}>
                    {grid.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor={versionFieldId}>
              Version
            </label>
            <Select
              value={sourceVersionId?.toString() ?? ""}
              onValueChange={(value) => setSourceVersionId(Number(value))}
              disabled={selectedGrid === null || isRunning}
            >
              <SelectTrigger id={versionFieldId}>
                <SelectValue placeholder="Choose version" />
              </SelectTrigger>
              <SelectContent>
                {(selectedGrid?.versions ?? [])
                  .slice()
                  .sort((left, right) => right.version - left.version)
                  .map((version) => (
                    <SelectItem key={version.id} value={version.id.toString()}>
                      v{version.version} · {version.label} · {version.status}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-3 rounded-lg border bg-muted/20 p-4">
          <div className="flex items-center gap-2">
            <Checkbox
              id={mappingsFieldId}
              checked={includeOwRankMappings}
              onCheckedChange={(checked) => setIncludeOwRankMappings(checked === true)}
              disabled={isRunning}
            />
            <label className="text-sm" htmlFor={mappingsFieldId}>
              OW rank mappings
            </label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id={iconsFieldId}
              checked={includeIcons}
              onCheckedChange={(checked) => setIncludeIcons(checked === true)}
              disabled={isRunning}
            />
            <label className="text-sm" htmlFor={iconsFieldId}>
              Copy tier icons
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={() => importMutation.mutate()}
            disabled={!request || importMutation.isPending || isRunning}
          >
            {importMutation.isPending || isRunning ? (
              <LoaderCircle aria-hidden className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download aria-hidden className="mr-2 h-4 w-4" />
            )}
            Import version
          </Button>
          {job && (
            <span
              className="flex items-center gap-2 text-sm tabular-nums text-muted-foreground"
              aria-live="polite"
            >
              {job.status === "completed" && (
                <CheckCircle2 aria-hidden className={`h-4 w-4 ${TONE_TEXT.success}`} />
              )}
              {job.status === "failed" && (
                <AlertCircle aria-hidden className={`h-4 w-4 ${TONE_TEXT.danger}`} />
              )}
              Import #{job.id} · {job.status}
            </span>
          )}
          {(job?.status === "completed" || job?.status === "failed") && (
            <Button variant="ghost" onClick={reset}>
              Import another version
            </Button>
          )}
        </div>

        {job?.status === "failed" && (
          <Alert variant="destructive">
            <AlertCircle aria-hidden className="h-4 w-4" />
            <AlertTitle>Import failed</AlertTitle>
            <AlertDescription>
              Nothing was copied into this workspace.{" "}
              {job.error ??
                "The import worker did not report a reason — retry the import, and ask an administrator to check the worker logs if it fails again."}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
