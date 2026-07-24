"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Download, LoaderCircle } from "lucide-react";

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

export function DivisionGridImportWizard({ workspaceId, canImport, onImported }: Props) {
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
        description: error instanceof Error ? error.message : "The import request failed."
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
        <CardTitle>Import one version</CardTitle>
        <CardDescription>
          Copy a specific division-grid version from another workspace. The imported version is not
          activated automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {workspacesQuery.isError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Workspaces could not be loaded</AlertTitle>
            <AlertDescription>
              {workspacesQuery.error instanceof Error
                ? workspacesQuery.error.message
                : "The workspace list is unavailable."}
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 lg:grid-cols-3">
          <label className="grid gap-2 text-sm font-medium">
            Source workspace
            <Select
              value={sourceWorkspaceId?.toString() ?? ""}
              onValueChange={(value) => {
                setSourceWorkspaceId(Number(value));
                setSourceGridId(null);
                setSourceVersionId(null);
              }}
              disabled={isRunning}
            >
              <SelectTrigger>
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
          </label>

          <label className="grid gap-2 text-sm font-medium">
            Division grid
            <Select
              value={sourceGridId?.toString() ?? ""}
              onValueChange={(value) => {
                setSourceGridId(Number(value));
                setSourceVersionId(null);
              }}
              disabled={sourceWorkspaceId === null || gridsQuery.isLoading || isRunning}
            >
              <SelectTrigger>
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
          </label>

          <label className="grid gap-2 text-sm font-medium">
            Version
            <Select
              value={sourceVersionId?.toString() ?? ""}
              onValueChange={(value) => setSourceVersionId(Number(value))}
              disabled={selectedGrid === null || isRunning}
            >
              <SelectTrigger>
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
          </label>
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-3 rounded-lg border bg-muted/20 p-4">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={includeOwRankMappings}
              onCheckedChange={(checked) => setIncludeOwRankMappings(checked === true)}
              disabled={isRunning}
            />
            OW rank mappings
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={includeIcons}
              onCheckedChange={(checked) => setIncludeIcons(checked === true)}
              disabled={isRunning}
            />
            Copy tier icons
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={() => importMutation.mutate()}
            disabled={!request || importMutation.isPending || isRunning}
          >
            {importMutation.isPending || isRunning ? (
              <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            Import version
          </Button>
          {job && (
            <span
              className="flex items-center gap-2 text-sm text-muted-foreground"
              aria-live="polite"
            >
              {job.status === "completed" && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
              {job.status === "failed" && <AlertCircle className="h-4 w-4 text-destructive" />}
              Import #{job.id}: {job.status}
            </span>
          )}
          {(job?.status === "completed" || job?.status === "failed") && (
            <Button variant="ghost" onClick={reset}>
              Import another
            </Button>
          )}
        </div>

        {job?.status === "failed" && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Import failed</AlertTitle>
            <AlertDescription>
              {job.error ?? "The import worker did not return an error."}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
