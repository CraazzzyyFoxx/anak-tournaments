"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileText,
  FolderInput,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  XCircle
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import { useDebounce } from "use-debounce";

import { TONE_CLASS, TONE_TEXT, type Tone } from "@/components/admin/tone";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InfiniteScrollFooter } from "@/components/ui/infinite-scroll";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useRealtimeTopic } from "@/hooks/useRealtimeTopic";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import adminService from "@/services/admin.service";
import type {
  LogProcessingRecord,
  LogProcessingStats,
  LogProcessingStatus
} from "@/types/admin.types";
import type { Encounter } from "@/types/encounter.types";
import { TournamentLogUploadDialog } from "./TournamentLogUploadDialog";
import {
  getTournamentWorkspaceQueryKeys,
  invalidateTournamentWorkspace
} from "./tournamentWorkspace.queryKeys";

const PAGE_SIZE = 25;
/**
 * Poll cadence used only while the queue still has work. When nothing is
 * pending the console is driven by the `workspace:{id}:logs` realtime signal
 * (parser publishes it on every completion), so an idle tab costs no requests —
 * the old console polled every 10s forever.
 */
const ACTIVE_QUEUE_POLL_MS = 10_000;
/** Collapse a burst of completions into one refetch. */
const REALTIME_REFRESH_DEBOUNCE_MS = 500;

type LogFilter = LogProcessingStatus | "all";

const STATUS_META: Record<LogProcessingStatus, { label: string; icon: LucideIcon; tone: Tone }> = {
  pending: { label: "Queued", icon: Clock3, tone: "neutral" },
  processing: { label: "Processing", icon: Loader2, tone: "info" },
  done: { label: "Processed", icon: CheckCircle2, tone: "success" },
  failed: { label: "Failed", icon: XCircle, tone: "danger" }
};

/** Filter order is scan order: the states that need action come first. */
const LOG_FILTERS: LogFilter[] = ["all", "failed", "processing", "pending", "done"];

const SOURCE_LABELS: Record<LogProcessingRecord["source"], string> = {
  upload: "Upload",
  discord: "Discord",
  manual: "Manual"
};

interface TournamentLogsTabProps {
  tournamentId: number;
  workspaceId: number | null;
  encounters: Encounter[];
  canUploadLogs: boolean;
  enabled: boolean;
}

function getLogFileName(filename: string) {
  return filename.split(/[\\/]/).at(-1) ?? filename;
}

function formatDuration(record: LogProcessingRecord) {
  if (!record.started_at || !record.finished_at) {
    return record.status === "processing" ? "running" : "-";
  }

  const durationMs = new Date(record.finished_at).getTime() - new Date(record.started_at).getTime();
  if (!Number.isFinite(durationMs) || durationMs < 0) return "-";
  return `${(durationMs / 1000).toFixed(1)}s`;
}

/** Matches `formatSyncTime` in ChallongeIntegrationSection so both admin logs read alike. */
function formatLogTime(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getErrorSummary(errorMessage: string | null) {
  if (!errorMessage) return null;

  const codeMatch = errorMessage.match(/['"]code['"]:\s*['"]([^'"]+)['"]/);
  const statusMatch = errorMessage.match(/^(\d{3})/);
  const code = codeMatch?.[1]?.replaceAll("_", " ");

  if (code) {
    const formattedCode = code.charAt(0).toUpperCase() + code.slice(1);
    return statusMatch ? `${statusMatch[1]} · ${formattedCode}` : formattedCode;
  }

  return errorMessage.replace(/^(\d{3}:\s*)?/, "").slice(0, 120);
}

function LogStatusBadge({ status }: Readonly<{ status: LogProcessingStatus }>) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;

  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5 whitespace-nowrap px-1.5 text-[11px]", TONE_CLASS[meta.tone])}
    >
      <Icon className={cn("size-3", status === "processing" && "animate-spin")} aria-hidden />
      {meta.label}
    </Badge>
  );
}

/** Counts come from the server aggregate, so a filter shows its real size. */
function getFilterCount(filter: LogFilter, stats: LogProcessingStats | undefined) {
  if (!stats) return null;
  return filter === "all" ? stats.total : stats[filter];
}

export function TournamentLogsTab({
  tournamentId,
  workspaceId,
  encounters,
  canUploadLogs,
  enabled
}: Readonly<TournamentLogsTabProps>) {
  const queryClient = useQueryClient();
  const queryKeys = getTournamentWorkspaceQueryKeys(tournamentId);
  const [statusFilter, setStatusFilter] = useState<LogFilter>("all");
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch] = useDebounce(searchInput, 300);
  const searchTerm = debouncedSearch.trim();

  const statsQuery = useQuery({
    queryKey: [...queryKeys.logHistory, "stats"],
    queryFn: () => adminService.getLogStats(tournamentId),
    enabled
  });
  const stats = statsQuery.data;
  const queueActive = stats != null && stats.pending + stats.processing > 0;
  const pollInterval = enabled && queueActive ? ACTIVE_QUEUE_POLL_MS : false;

  const historyQuery = useInfiniteQuery({
    queryKey: [...queryKeys.logHistory, "list", statusFilter, searchTerm],
    queryFn: ({ pageParam }) =>
      adminService.getLogHistory(tournamentId, {
        limit: PAGE_SIZE,
        offset: pageParam,
        status: statusFilter === "all" ? undefined : statusFilter,
        search: searchTerm
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((count, page) => count + page.items.length, 0);
      // A page shorter than requested means the tail; stop even if `total`
      // grew underneath us while the operator was scrolling.
      if (lastPage.items.length < PAGE_SIZE || loaded >= lastPage.total) return undefined;
      return loaded;
    },
    enabled,
    refetchInterval: pollInterval
  });

  // Offset paging over a list that grows at the head can repeat a record across
  // page boundaries. Keying by id collapses those: position comes from where the
  // record first appeared, the value from the freshest page carrying it.
  const records = Array.from(
    new Map(
      (historyQuery.data?.pages ?? [])
        .flatMap((page) => page.items)
        .map((record) => [record.id, record] as const)
    ).values()
  );
  const matchedTotal = historyQuery.data?.pages[0]?.total;
  const loadedFailures = records.filter((record) => record.status === "failed");
  const hasActiveFilter = statusFilter !== "all" || searchTerm.length > 0;

  const refreshAll = () => {
    void statsQuery.refetch();
    void historyQuery.refetch();
  };

  // Parser signals completions on the workspace topic, so the console stays live
  // without polling. Debounced: a batch upload emits one signal per file.
  const [scheduleRealtimeRefresh] = useDebounce(refreshAll, REALTIME_REFRESH_DEBOUNCE_MS);
  useRealtimeTopic(
    enabled && workspaceId != null ? `workspace:${workspaceId}:logs` : null,
    () => scheduleRealtimeRefresh(),
    [scheduleRealtimeRefresh]
  );

  const retryLogMutation = useMutation({
    mutationFn: (recordId: number) => adminService.retryLogRecord(recordId),
    onSuccess: () => {
      notify.success("Log retry queued");
      refreshAll();
    }
  });

  const retryFailuresMutation = useMutation({
    mutationFn: async (recordIds: number[]) => {
      const results = await Promise.allSettled(
        recordIds.map((recordId) => adminService.retryLogRecord(recordId))
      );
      return results.filter((result) => result.status === "rejected").length;
    },
    onSuccess: (failedCount, recordIds) => {
      const queued = recordIds.length - failedCount;
      if (failedCount > 0) {
        notify.error(`Queued ${queued} of ${recordIds.length} logs`, {
          description: `${failedCount} could not be queued. Retry them individually.`
        });
      } else {
        notify.success(`Queued ${queued} logs for retry`);
      }
      refreshAll();
    }
  });

  const processAllLogsMutation = useMutation({
    mutationFn: () => adminService.processAllTournamentLogs(tournamentId),
    onSuccess: () => {
      notify.success("Processing queued for all S3 logs");
      refreshAll();
    }
  });

  const isRetrying = (recordId: number) =>
    (retryLogMutation.isPending && retryLogMutation.variables === recordId) ||
    (retryFailuresMutation.isPending && retryFailuresMutation.variables?.includes(recordId));

  return (
    <TooltipProvider>
      <Card className="border-border/40">
        <CardHeader className="gap-2 pb-3">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <FolderInput className="size-4 shrink-0 text-primary" aria-hidden />
                <CardTitle asChild className="text-base font-semibold">
                  <h2>Log processing</h2>
                </CardTitle>
              </div>
              <CardDescription className="mt-1 text-pretty">
                Track uploaded and Discord/S3 match logs, isolate failures, and queue retries.
                Stalled logs are requeued automatically.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {canUploadLogs ? (
                <TournamentLogUploadDialog
                  tournamentId={tournamentId}
                  encounters={encounters}
                  onUploaded={() => {
                    invalidateTournamentWorkspace(queryClient, tournamentId);
                    refreshAll();
                  }}
                  trigger={
                    <Button variant="outline" size="sm" className="h-8">
                      Upload logs
                    </Button>
                  }
                />
              ) : null}
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                disabled={processAllLogsMutation.isPending}
                onClick={() => processAllLogsMutation.mutate()}
              >
                {processAllLogsMutation.isPending ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : null}
                Process S3 logs
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label="Refresh log processing"
                    onClick={refreshAll}
                    disabled={historyQuery.isFetching || statsQuery.isFetching}
                  >
                    <RefreshCw
                      className={cn(
                        (historyQuery.isFetching || statsQuery.isFetching) && "animate-spin"
                      )}
                      aria-hidden
                    />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Refresh log processing</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-3 p-4 pt-0">
          {/*
            One row replaces the old five stat tiles plus a separate filter
            group: both listed the same statuses, and the tiles only ever
            counted the page that happened to be loaded.
          */}
          <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
            <ToggleGroup
              type="single"
              value={statusFilter}
              onValueChange={(value) => value && setStatusFilter(value as LogFilter)}
              className="w-full flex-wrap justify-start xl:w-auto"
              size="sm"
              variant="outline"
              aria-label="Filter logs by processing status"
            >
              {LOG_FILTERS.map((filter) => {
                const count = getFilterCount(filter, stats);
                // Only the states that need an operator get a tone; tinting
                // "Processed" too would pull the eye to the inert majority.
                const tone = filter === "failed" || filter === "processing";

                return (
                  <ToggleGroupItem key={filter} value={filter} className="h-8 gap-1.5 text-xs">
                    {filter === "all" ? "All" : STATUS_META[filter].label}
                    <span
                      className={cn(
                        "tabular-nums",
                        tone && count
                          ? TONE_TEXT[STATUS_META[filter].tone]
                          : "text-muted-foreground"
                      )}
                    >
                      {count?.toLocaleString() ?? "—"}
                    </span>
                  </ToggleGroupItem>
                );
              })}
            </ToggleGroup>

            <div className="flex items-center gap-3">
              {stats ? (
                <p className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                  Avg{" "}
                  <span className="tabular-nums text-foreground/80">
                    {stats.avg_duration_seconds != null
                      ? `${stats.avg_duration_seconds.toFixed(1)}s`
                      : "-"}
                  </span>
                  {stats.last_created_at ? (
                    <>
                      {" · newest "}
                      <span className="tabular-nums text-foreground/80">
                        {formatLogTime(stats.last_created_at)}
                      </span>
                    </>
                  ) : null}
                </p>
              ) : null}
              <div className="relative w-full xl:w-64">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="file, error, uploader, encounter"
                  className="h-8 pl-8 text-base sm:text-xs"
                  aria-label="Search all logs for this tournament"
                />
              </div>
            </div>
          </div>

          {stats && stats.failed > 0 ? (
            <div className="flex flex-col gap-2 rounded-lg border border-danger/25 bg-danger/5 px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between">
              <p className="min-w-0 text-danger">
                {stats.failed.toLocaleString()} log{stats.failed === 1 ? "" : "s"} failed to process
              </p>
              <div className="flex shrink-0 flex-wrap items-center gap-1">
                {statusFilter !== "failed" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setStatusFilter("failed")}
                  >
                    Show failed
                  </Button>
                ) : null}
                {loadedFailures.length > 0 ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={retryFailuresMutation.isPending}
                    onClick={() =>
                      retryFailuresMutation.mutate(loadedFailures.map((record) => record.id))
                    }
                  >
                    {retryFailuresMutation.isPending ? (
                      <Loader2 className="animate-spin" aria-hidden />
                    ) : (
                      <RotateCcw aria-hidden />
                    )}
                    Retry {loadedFailures.length} loaded
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

          {historyQuery.isPending ? (
            <div className="flex flex-col gap-1.5" aria-hidden>
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
            </div>
          ) : records.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/50 px-4 py-8 text-center">
              {hasActiveFilter ? (
                <>
                  <Search className="mx-auto size-6 text-muted-foreground" aria-hidden />
                  <p className="mt-3 text-sm font-medium">
                    {searchTerm ? `No logs match “${searchTerm}”` : "No logs in this status"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Search covers every log in this tournament, not just the loaded rows.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-4"
                    onClick={() => {
                      setStatusFilter("all");
                      setSearchInput("");
                    }}
                  >
                    Clear filters
                  </Button>
                </>
              ) : (
                <>
                  <FileText className="mx-auto size-6 text-muted-foreground" aria-hidden />
                  <p className="mt-3 text-sm font-medium">No logs for this tournament yet</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Upload log files or process the tournament&apos;s stored S3 logs to populate
                    this console.
                  </p>
                </>
              )}
            </div>
          ) : (
            <>
              <ul className="divide-y divide-border/30 overflow-hidden rounded-lg border border-border/40">
                {records.map((record) => {
                  const fileName = getLogFileName(record.filename);
                  const errorSummary = getErrorSummary(record.error_message);
                  const retrying = isRetrying(record.id);
                  // "Queued"/"Processing" rows go stale when the worker drops
                  // their queue message; the reaper requeues them on its own
                  // schedule, this is the operator's shortcut past the wait.
                  const canRequeue = record.status !== "done";
                  const requeueLabel = record.status === "failed" ? "Retry log" : "Requeue log";

                  return (
                    <li
                      key={record.id}
                      className={cn(
                        "px-3 py-1.5 transition-colors hover:bg-accent/20",
                        record.status === "failed" && "bg-danger/5 hover:bg-danger/10"
                      )}
                    >
                      {/*
                        One line per record. The uploader and source used to sit
                        on a second line under every filename, which doubled the
                        row height to repeat the same two values 25 times; both
                        now ride the row's tooltip.
                      */}
                      <div
                        className="flex flex-wrap items-center gap-x-3 gap-y-0.5"
                        title={`${record.filename}\n${SOURCE_LABELS[record.source]} by ${record.uploader_name ?? "unknown uploader"}${record.attempts > 1 ? `\n${record.attempts} processing attempts` : ""}`}
                      >
                        <p className="min-w-0 flex-1 basis-48 truncate font-mono text-xs">
                          {fileName}
                        </p>
                        <p className="min-w-0 flex-1 basis-40 truncate text-xs text-muted-foreground">
                          {record.attached_encounter_name ?? "Not attached"}
                        </p>
                        <div className="flex w-28 shrink-0 items-center gap-1.5">
                          <LogStatusBadge status={record.status} />
                          {record.attempts > 1 ? (
                            <span className="text-[11px] tabular-nums text-muted-foreground">
                              ×{record.attempts}
                            </span>
                          ) : null}
                        </div>
                        <p className="w-28 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                          {formatLogTime(record.created_at)}
                        </p>
                        <p className="w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                          {formatDuration(record)}
                        </p>
                        <div className="flex w-8 shrink-0 justify-end">
                          {canRequeue ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-8"
                                  aria-label={`${requeueLabel} ${fileName}`}
                                  disabled={retrying}
                                  onClick={() => retryLogMutation.mutate(record.id)}
                                >
                                  {retrying ? (
                                    <Loader2 className="animate-spin" aria-hidden />
                                  ) : (
                                    <RotateCcw aria-hidden />
                                  )}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>{requeueLabel}</TooltipContent>
                            </Tooltip>
                          ) : null}
                        </div>
                      </div>

                      {errorSummary ? (
                        <details className="group mt-1.5">
                          <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded text-xs text-danger focus-visible:outline-2 focus-visible:outline-offset-2">
                            <ChevronRight
                              className="size-3 transition-transform group-open:rotate-90"
                              aria-hidden
                            />
                            {errorSummary}
                          </summary>
                          <pre
                            tabIndex={0}
                            className="mt-1.5 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/20 p-2 text-xs text-muted-foreground"
                          >
                            {record.error_message}
                          </pre>
                        </details>
                      ) : null}
                    </li>
                  );
                })}
              </ul>

              <InfiniteScrollFooter
                loaded={records.length}
                total={matchedTotal}
                unit="logs"
                hasNextPage={historyQuery.hasNextPage}
                isFetchingNextPage={historyQuery.isFetchingNextPage}
                fetchNextPage={historyQuery.fetchNextPage}
                isError={historyQuery.isError}
              />
            </>
          )}
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}
