"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Download, LoaderCircle, Store } from "lucide-react";
import Image from "next/image";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
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
  DivisionGridMarketplaceImportRequest,
  DivisionGridMarketplacePreflightResult
} from "@/types/workspace.types";

type ImportMode = NonNullable<DivisionGridMarketplaceImportRequest["mode"]>;
type WizardStep = "source" | "grids" | "review" | "progress";

interface Props {
  workspaceId: number;
  canImport: boolean;
  onImported: (job: DivisionGridImportJob) => Promise<void> | void;
}

export function DivisionGridImportWizard({ workspaceId, canImport, onImported }: Props) {
  const [step, setStep] = useState<WizardStep>("source");
  const [sourceWorkspaceId, setSourceWorkspaceId] = useState<number | null>(null);
  const [selectedGridIds, setSelectedGridIds] = useState<number[]>([]);
  const [mode, setMode] = useState<ImportMode>("library");
  const [preflight, setPreflight] = useState<DivisionGridMarketplacePreflightResult | null>(null);
  const [activeJobId, setActiveJobId] = useState<number | null>(null);
  const reportedJobIdRef = useRef<number | null>(null);

  const workspacesQuery = useQuery({
    queryKey: ["division-grid-marketplace-workspaces", workspaceId],
    queryFn: () => workspaceService.getDivisionGridMarketplaceWorkspaces(workspaceId),
    enabled: canImport
  });
  const gridsQuery = useQuery({
    queryKey: ["division-grid-marketplace", workspaceId, sourceWorkspaceId],
    queryFn: () => workspaceService.getDivisionGridMarketplace(workspaceId, sourceWorkspaceId!),
    enabled: canImport && sourceWorkspaceId !== null
  });
  const activeJobsQuery = useQuery({
    queryKey: ["division-grid-import-jobs", workspaceId, "active"],
    queryFn: () => workspaceService.getDivisionGridImportJobs(workspaceId, true, 1),
    enabled: canImport && activeJobId === null,
    refetchInterval: activeJobId === null ? 5000 : false
  });
  const jobQuery = useQuery({
    queryKey: ["division-grid-import-job", workspaceId, activeJobId],
    queryFn: () => workspaceService.getDivisionGridImportJob(workspaceId, activeJobId!),
    enabled: activeJobId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "pending" || status === "running" ? 1200 : false;
    }
  });

  const request = useMemo<DivisionGridMarketplaceImportRequest | null>(() => {
    if (sourceWorkspaceId === null || selectedGridIds.length === 0) return null;
    return {
      source_workspace_id: sourceWorkspaceId,
      source_grid_ids: selectedGridIds,
      mode
    };
  }, [mode, selectedGridIds, sourceWorkspaceId]);

  const preflightMutation = useMutation({
    mutationFn: async () => {
      if (!request) throw new Error("Select at least one grid.");
      return workspaceService.preflightDivisionGridMarketplace(workspaceId, request);
    },
    onSuccess: (result) => {
      setPreflight(result);
      setStep("review");
    },
    onError: (error) =>
      notify.error("Import preflight failed", {
        description: error instanceof Error ? error.message : "The import request failed."
      })
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!request) throw new Error("The import selection is incomplete.");
      return workspaceService.importDivisionGridMarketplace(workspaceId, request);
    },
    onSuccess: (job) => {
      setActiveJobId(job.id);
      reportedJobIdRef.current = null;
      setStep("progress");
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
    notify.success("Division grids added to the library", {
      description: `${job.result?.created_grids ?? 0} new grid(s), ${job.result?.created_versions ?? 0} version(s)`
    });
  }, [jobQuery.data, onImported]);

  if (!canImport) return null;

  const grids = gridsQuery.data ?? [];
  const selected = new Set(selectedGridIds);
  const job = jobQuery.data;

  const reset = () => {
    setStep("source");
    setSourceWorkspaceId(null);
    setSelectedGridIds([]);
    setPreflight(null);
    setActiveJobId(null);
    reportedJobIdRef.current = null;
  };

  return (
    <Card id="import" className="overflow-hidden">
      <CardHeader className="border-b bg-muted/20">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Store className="h-4 w-4" /> Import from workspace library
            </CardTitle>
            <CardDescription className="mt-1">
              Preflight assets and conflicts before a traceable background import. Imports never
              activate a grid automatically.
            </CardDescription>
          </div>
          <div className="flex gap-1" aria-label="Import steps">
            {(["source", "grids", "review", "progress"] as const).map((item, index) => (
              <Badge key={item} variant={step === item ? "default" : "outline"}>
                {index + 1}. {item}
              </Badge>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 p-5">
        {workspacesQuery.isError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Workspace library unavailable</AlertTitle>
            <AlertDescription>
              {workspacesQuery.error instanceof Error
                ? workspacesQuery.error.message
                : "The workspace library could not be loaded."}
            </AlertDescription>
          </Alert>
        )}
        {step !== "progress" && activeJobsQuery.data?.[0] && (
          <Alert>
            <LoaderCircle className="h-4 w-4 animate-spin" />
            <AlertTitle>Import #{activeJobsQuery.data[0].id} is still running</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
              <span>Resume its durable progress view before starting another import.</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setActiveJobId(activeJobsQuery.data![0].id);
                  setStep("progress");
                }}
              >
                Resume import
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {step === "source" && (
          <div className="space-y-4">
            <label className="grid max-w-xl gap-2 text-sm font-medium">
              Source workspace
              <Select
                value={sourceWorkspaceId?.toString() ?? ""}
                onValueChange={(value) => {
                  setSourceWorkspaceId(Number(value));
                  setSelectedGridIds([]);
                  setPreflight(null);
                  setStep("grids");
                }}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={workspacesQuery.isLoading ? "Loading…" : "Choose a workspace"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {(workspacesQuery.data ?? []).map((workspace) => (
                    <SelectItem key={workspace.id} value={workspace.id.toString()}>
                      {workspace.name} · {workspace.grids_count} grid(s)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            {!workspacesQuery.isLoading && (workspacesQuery.data ?? []).length === 0 && (
              <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                No accessible workspace currently exposes division grids.
              </div>
            )}
          </div>
        )}

        {step === "grids" && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <label className="grid gap-2 text-sm font-medium">
                Import behavior
                <Select value={mode} onValueChange={(value) => setMode(value as ImportMode)}>
                  <SelectTrigger className="w-64">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="library">Add to library</SelectItem>
                    <SelectItem value="sync">Replace prior imported copy</SelectItem>
                    <SelectItem value="copy">Create independent copy</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <Button variant="outline" onClick={() => setStep("source")}>
                Change workspace
              </Button>
            </div>

            {gridsQuery.isError ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Grids could not be loaded</AlertTitle>
                <AlertDescription>
                  {gridsQuery.error instanceof Error
                    ? gridsQuery.error.message
                    : "The selected workspace grids could not be loaded."}
                </AlertDescription>
              </Alert>
            ) : gridsQuery.isLoading ? (
              <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                Loading grids…
              </div>
            ) : grids.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                This workspace has no division grids.
              </div>
            ) : (
              <div className="grid gap-3 xl:grid-cols-2">
                {grids.map((grid) => (
                  <label
                    key={grid.id}
                    className={`flex cursor-pointer gap-3 rounded-xl border p-4 transition-colors ${selected.has(grid.id) ? "border-primary bg-primary/5" : "hover:bg-muted/40"}`}
                  >
                    <Checkbox
                      checked={selected.has(grid.id)}
                      onCheckedChange={(checked) =>
                        setSelectedGridIds((current) =>
                          checked === true
                            ? Array.from(new Set([...current, grid.id]))
                            : current.filter((id) => id !== grid.id)
                        )
                      }
                      aria-label={`Select ${grid.name}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2 font-medium">
                        {grid.name}
                        <Badge variant="outline">{grid.slug}</Badge>
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {grid.versions_count} version(s) · {grid.tiers_count} tier(s)
                      </span>
                      <span className="mt-3 flex flex-wrap gap-1">
                        {grid.preview_icon_urls.slice(0, 8).map((url, index) => (
                          <span
                            key={`${url}-${index}`}
                            className="grid h-8 w-8 place-items-center rounded border bg-background"
                          >
                            <Image
                              src={url}
                              alt=""
                              width={24}
                              height={24}
                              className="h-6 w-6 object-contain"
                            />
                          </span>
                        ))}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}
            <Button
              onClick={() => preflightMutation.mutate()}
              disabled={!request || preflightMutation.isPending}
            >
              {preflightMutation.isPending && (
                <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
              )}
              Review import
            </Button>
          </div>
        )}

        {step === "review" && preflight && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                ["Grids", preflight.grids_count],
                ["Versions", preflight.versions_count],
                ["Tiers", preflight.tiers_count],
                ["Mappings", preflight.mappings_count],
                ["Assets copied", preflight.assets_to_copy],
                ["Assets reused", preflight.assets_to_reuse],
                ["External URLs", preflight.external_assets],
                ["Slug conflicts", preflight.conflicts.length]
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border bg-muted/20 p-3">
                  <div className="text-xs text-muted-foreground">{label}</div>
                  <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
                </div>
              ))}
            </div>
            {(preflight.conflicts.length > 0 || preflight.warnings.length > 0) && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Review required</AlertTitle>
                <AlertDescription className="space-y-1">
                  {preflight.conflicts.length > 0 && (
                    <div>
                      Conflicting slugs will receive a safe copy suffix:{" "}
                      {preflight.conflicts.join(", ")}.
                    </div>
                  )}
                  {preflight.warnings.map((warning, index) => (
                    <div key={`${warning.message}-${index}`}>{warning.message}</div>
                  ))}
                </AlertDescription>
              </Alert>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setStep("grids")}>
                Back
              </Button>
              <Button onClick={() => importMutation.mutate()} disabled={importMutation.isPending}>
                <Download className="mr-2 h-4 w-4" /> Start background import
              </Button>
            </div>
          </div>
        )}

        {step === "progress" && (
          <div className="space-y-4" aria-live="polite">
            {jobQuery.isError ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Job status unavailable</AlertTitle>
                <AlertDescription>
                  {jobQuery.error instanceof Error
                    ? jobQuery.error.message
                    : "The import job could not be loaded."}
                </AlertDescription>
              </Alert>
            ) : (
              <>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="font-medium">Import job {job ? `#${job.id}` : "starting"}</div>
                    <div className="text-sm capitalize text-muted-foreground">
                      {job?.status ?? "pending"}
                    </div>
                  </div>
                  {job?.status === "completed" ? (
                    <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                  ) : job?.status === "failed" ? (
                    <AlertCircle className="h-6 w-6 text-destructive" />
                  ) : (
                    <LoaderCircle className="h-6 w-6 animate-spin text-primary" />
                  )}
                </div>
                <Progress value={job?.progress ?? 0} />
                {job?.status === "failed" && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Import failed</AlertTitle>
                    <AlertDescription>
                      {job.error ?? "The worker did not provide an error."}
                    </AlertDescription>
                  </Alert>
                )}
                {job?.status === "completed" && (
                  <div className="rounded-lg border bg-emerald-500/5 p-4 text-sm">
                    Added {job.result?.created_grids ?? 0} grid(s),{" "}
                    {job.result?.created_versions ?? 0} version(s), and copied{" "}
                    {job.result?.copied_images ?? 0} private asset(s).
                  </div>
                )}
              </>
            )}
            {(job?.status === "completed" || job?.status === "failed") && (
              <Button variant="outline" onClick={reset}>
                Start another import
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
