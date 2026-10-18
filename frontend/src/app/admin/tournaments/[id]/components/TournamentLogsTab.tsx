"use client";

import { useIsFetching, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  CheckCircle2,
  ChevronRight,
  Clock3,
  FolderInput,
  Link2,
  Loader2,
  RefreshCw,
  RotateCcw,
  XCircle
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useFormatter } from "@/lib/datetime/client";
import { columnMeta, createKebabColumn, DataTable } from "@/components/data-table";
import { StatusPill } from "@/components/kit/StatusPill";
import { type Tone } from "@/components/kit/tone";
import { RawLogStatus } from "@/components/match/MatchLogIndicator";
import type { DateFormatter } from "@/components/kit/format-time";
import { Button } from "@/components/ui/button";
import { FilterBar } from "@/components/kit/FilterBar";
import { useFilters, type FilterDef } from "@/components/kit/useFilters";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useInvalidation } from "@/hooks/useInvalidation";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import adminService from "@/services/admin.service";
import { AttachLogDialog } from "./AttachLogDialog";
import {
  getLogFileName,
  getRetryKind,
  logOperationErrorCode,
  retryRequestFor
} from "./logs.helpers";
import { getApiErrorMessage } from "@/lib/api/error";
import type {
  LogBindRequest,
  LogProcessingRecord,
  LogProcessingStats,
  LogProcessingStatus
} from "@/types/admin.types";
import type { Encounter } from "@/types/encounter.types";
import { TournamentLogUploadDialog } from "@/components/logs/TournamentLogUploadDialog";
import {
  getTournamentWorkspaceQueryKeys,
  invalidateTournamentWorkspace
} from "@/lib/tournament/workspace-query-keys";
import { Spinner } from "@/components/ui/spinner";
import { adminQueryKeys } from "@/lib/admin/query-keys";

const PAGE_SIZE = 25;
/**
 * Poll cadence used only while the queue still has work. When nothing is
 * pending the console is driven by the `workspace.logs` invalidation (parser
 * publishes it on every completion), so an idle tab costs no requests — the old
 * console polled every 10s forever.
 */
const ACTIVE_QUEUE_POLL_MS = 10_000;

type LogFilter = LogProcessingStatus;

const STATUS_META: Record<LogProcessingStatus, { key: "queued" | "processing" | "awaitingLink" | "processed" | "failed"; icon: LucideIcon; tone: Tone }> = {
  pending: { key: "queued", icon: Clock3, tone: "neutral" },
  processing: { key: "processing", icon: Loader2, tone: "info" },
  awaiting_link: { key: "awaitingLink", icon: Link2, tone: "neutral" },
  done: { key: "processed", icon: CheckCircle2, tone: "success" },
  failed: { key: "failed", icon: XCircle, tone: "danger" }
};

/** Chip order is scan order: the states that need action come first. */
const LOG_FILTERS: LogFilter[] = ["failed", "awaiting_link", "processing", "pending", "done"];

const SOURCE_LABELS: Partial<Record<string, "sourceUpload" | "sourceDiscord" | "sourceManual" | "sourceHistoricalReference">> = {
  upload: "sourceUpload",
  discord: "sourceDiscord",
  manual: "sourceManual",
  historical_reference: "sourceHistoricalReference"
};

interface TournamentLogsTabProps {
  /** `null` = every tournament in the workspace. */
  tournamentId: number | null;
  workspaceId: number | null;
  encounters: Encounter[];
  canUploadLogs: boolean;
}

function getRetryRefusal(record: LogProcessingRecord): "retryRawUnavailable" | "retryHistorical" | "retryUnbound" | null {
  if (!record.raw_available) return "retryRawUnavailable";
  if (record.source === "historical_reference") return "retryHistorical";
  if (record.status !== "awaiting_link" && record.attached_encounter_id != null && record.attached_encounter_game_id == null) {
    return "retryUnbound";
  }
  return null;
}

/**
 * Explicit bind: an awaiting or failed job whose stored document teams are known, with a verified raw source and
 * not a historical reference. Independent of the ordinary-retry refusals (`retryUnbound` reflects hints only).
 */
function canBindExplicitly(record: LogProcessingRecord) {
  return (
    (record.status === "awaiting_link" || record.status === "failed") &&
    record.teams.length > 0 &&
    record.raw_available &&
    record.source !== "historical_reference"
  );
}

/** Done rows reparse (current evidence only); unfinished ones retry; nothing is offered while a source is refused. */
function isRetryable(record: LogProcessingRecord) {
  return getRetryKind(record) != null && getRetryRefusal(record) == null;
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
function formatLogTime(format: DateFormatter, value: string) {
  return format.dateTime(new Date(value), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

/** A structured error names its code; historical text (code `historical`) keeps the legacy status parse. */
function getErrorSummary(record: LogProcessingRecord) {
  const structured = record.error && record.error.code !== "historical" ? record.error : null;
  const errorMessage = record.error_message;
  if (!structured && !errorMessage) return null;

  const codeMatch = errorMessage?.match(/['"]code['"]:\s*['"]([^'"]+)['"]/);
  const statusMatch = errorMessage?.match(/^(\d{3})/);
  const code = (structured?.code ?? codeMatch?.[1])?.replaceAll("_", " ");

  if (code) {
    const formattedCode = code.charAt(0).toUpperCase() + code.slice(1);
    return statusMatch ? `${statusMatch[1]} · ${formattedCode}` : formattedCode;
  }

  return errorMessage!.replace(/^(\d{3}:\s*)?/, "").slice(0, 120);
}

/** The message plus every issue path the validator reported. */
function getErrorDetail(record: LogProcessingRecord) {
  const issues = record.error && record.error.code !== "historical" ? record.error.issues : [];
  return [record.error_message, ...issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`)]
    .filter(Boolean)
    .join("\n");
}

function LogStatusBadge({ status }: Readonly<{ status: LogProcessingStatus }>) {
  const t = useTranslations("adminTournament.logs");
  const meta = STATUS_META[status];
  const Icon = meta.icon;

  return (
    <StatusPill tone={meta.tone} className="px-1.5">
      <Icon className={cn("size-3", status === "processing" && "animate-spin")} aria-hidden />
      {t(meta.key)}
    </StatusPill>
  );
}

/** Counts come from the server aggregate, so a chip shows its real size. */
function getFilterCount(filter: LogFilter, stats: LogProcessingStats | undefined) {
  return stats ? stats[filter] : undefined;
}

export function TournamentLogsTab({
  tournamentId,
  workspaceId,
  encounters,
  canUploadLogs
}: Readonly<TournamentLogsTabProps>) {
  const t = useTranslations("adminTournament.logs");
  const tx = useTranslations("adminTournament.logsExtra");
  const format = useFormatter();
  const queryClient = useQueryClient();
  // Scoped to a tournament inside the hub, to the workspace on the
  // cross-tournament browser. Both keys are what realtime and the tab badge
  // address, so nothing here invents a key of its own.
  const historyKey = useMemo(
    () =>
      tournamentId != null
        ? getTournamentWorkspaceQueryKeys(tournamentId).logHistory
        : adminQueryKeys.workspaceLogHistory(workspaceId),
    [tournamentId, workspaceId]
  );

  const statsQuery = useQuery({
    queryKey: [...historyKey, "stats"],
    queryFn: () =>
      tournamentId != null
        ? adminService.getLogStats(tournamentId)
        : adminService.getLogStats(undefined, { workspaceId })
  });
  const stats = statsQuery.data;
  const queueActive = stats != null && stats.pending + stats.processing > 0;
  const isFetching = useIsFetching({ queryKey: historyKey }) > 0;

  // The table owns the page query, so the poll stales it from here. Only while
  // the queue has work: an idle console is driven by `workspace.logs` alone.
  useEffect(() => {
    if (!queueActive) return;
    const timer = setInterval(
      () => void queryClient.invalidateQueries({ queryKey: historyKey }),
      ACTIVE_QUEUE_POLL_MS
    );
    return () => clearInterval(timer);
  }, [queueActive, queryClient, historyKey]);

  // One single-select chip instead of a five-button toggle group, and the
  // choice now lives in the URL: a "show me the failures" link is shareable,
  // which component state could never be.
  const defs = useMemo<FilterDef[]>(
    () => [
      {
        key: "status",
        label: t("status"),
        kind: "single",
        options: LOG_FILTERS.map((filter) => ({
          value: filter,
          label: t(STATUS_META[filter].key),
          count: getFilterCount(filter, stats)
        }))
      }
    ],
    [stats, t]
  );
  const filters = useFilters(defs);
  const rawStatus = String(filters.values.status ?? "");
  const statusFilter = (LOG_FILTERS as readonly string[]).includes(rawStatus)
    ? (rawStatus as LogFilter)
    : null;

  const refreshAll = () => void queryClient.invalidateQueries({ queryKey: historyKey });

  // Parser completions arrive as `workspace.logs`, which stales exactly this
  // console's history key — and the stats query keyed under it. `tournamentId`
  // is what tells the registry which of the two variants of that key exists
  // here: the signal is workspace-wide, the console is mounted per tournament.
  useInvalidation({
    scopeKind: "workspace",
    scopeId: workspaceId,
    tournamentId
  });

  const failureMessage = (reason: unknown) => {
    const code = logOperationErrorCode(reason);
    return code ? tx(`opError.${code}`) : getApiErrorMessage(reason);
  };

  const retryMutation = useMutation({
    // Each row is its own request: a done row reparses with the revision captured when the page was read, so
    // a stale, busy or superseded row fails alone and is reported by name.
    mutationFn: async (records: LogProcessingRecord[]) => {
      const results = await Promise.allSettled(
        records.map((record) => adminService.retryLogRecord(record.id, retryRequestFor(record)))
      );
      return results.flatMap((result, index) =>
        result.status === "rejected" ? [{ record: records[index]!, reason: result.reason }] : []
      );
    },
    onSuccess: (failures, records) => {
      const ok = records.length - failures.length;
      if (failures.length > 0) {
        notify.error(tx("retryPartial", { ok, total: records.length }), {
          description: (
            <ul className="list-disc pl-4">
              {failures.map(({ record, reason }) => (
                <li key={record.id}>{`${getLogFileName(record.filename)}: ${failureMessage(reason)}`}</li>
              ))}
            </ul>
          )
        });
      } else if (records.some((record) => getRetryKind(record) === "reparse")) {
        notify.success(tx("retryProcessed", { count: ok }));
      } else {
        notify.success(ok === 1 ? t("retryQueuedSingle") : t("retryQueuedPlural", { count: ok }));
      }
      refreshAll();
    }
  });

  const processAllLogsMutation = useMutation({
    mutationFn: () => adminService.processAllTournamentLogs(tournamentId!),
    onSuccess: () => {
      notify.success(t("processS3Queued"));
      refreshAll();
    }
  });

  const [attachTarget, setAttachTarget] = useState<LogProcessingRecord | null>(null);
  const attachMutation = useMutation({
    mutationFn: ({ recordId, encounterId, encounterGameId }: {
      recordId: number; encounterId: number; encounterGameId: number;
    }) => adminService.retryLogRecord(recordId, {
      encounter_id: encounterId,
      encounter_game_id: encounterGameId
    }),
    onSuccess: () => {
      notify.success(t("attachedQueued"));
      setAttachTarget(null);
      refreshAll();
    },
    onError: (error) => notify.apiError(error)
  });

  const bindMutation = useMutation({
    mutationFn: ({ recordId, request }: { recordId: number; request: LogBindRequest }) =>
      adminService.bindLogRecord(recordId, request),
    onSuccess: (job) => {
      if (job.status === "done") {
        notify.success(tx("bound"));
      } else {
        notify.error(tx("boundNotDone", { status: job.status }), { description: job.error?.message });
      }
      setAttachTarget(null);
      refreshAll();
    },
    onError: (error) => {
      const code = logOperationErrorCode(error);
      if (code == null) return notify.apiError(error);
      notify.error(tx(`opError.${code}`), { description: getApiErrorMessage(error) });
      // The operator's view is stale: re-read the list and the game's occupancy before another attempt.
      if (code === "stale_revision" || code === "expected_revision_required" || code === "stale_binding") {
        refreshAll();
      }
    }
  });

  const columns: ColumnDef<LogProcessingRecord>[] = [
    {
      id: "file",
      header: t("file"),
      accessorFn: (record) => getLogFileName(record.filename),
      enableSorting: false,
      cell: ({ row }) => {
        const record = row.original;
        const sourceLabel = Object.hasOwn(SOURCE_LABELS, record.source) ? SOURCE_LABELS[record.source] : undefined;
        return (
          <div className="space-y-1">
          <p
            className="max-w-[22rem] truncate font-mono text-xs"
            title={record.source === "historical_reference"
              ? `${record.filename}\n${t("sourceHistoricalReference")}`
              : tx("titleHint", { filename: record.filename, source: sourceLabel ? t(sourceLabel) : record.source, uploader: record.uploader_name ?? t("unknownUploader"), attempts: record.attempts > 1 ? record.attempts : 0 })}
          >
            {getLogFileName(record.filename)}
          </p>
            {record.source === "historical_reference" ? (
              <p className="text-xs text-muted-foreground">{t("sourceHistoricalReference")}</p>
            ) : null}
          </div>
        );
      }
    },
    {
      id: "encounter",
      header: t("encounter"),
      accessorFn: (record) => record.attached_encounter_name ?? "",
      enableSorting: false,
      cell: ({ row }) => (
        <p className="max-w-[16rem] truncate text-xs text-muted-foreground">
          {row.original.attached_encounter_name ?? t("notAttached")}
        </p>
      )
    },
    {
      id: "status",
      header: t("status"),
      accessorFn: (record) => t(STATUS_META[record.status].key),
      size: 136,
      enableSorting: false,
      cell: ({ row }) => {
        const record = row.original;
        const refusal = getRetryRefusal(record);
        return (
          <div className="max-w-[22rem] space-y-1.5">
            <div className="flex items-center gap-1.5">
              <LogStatusBadge status={record.status} />
              {record.attempts > 1 ? (
                <span className="text-xs tabular-nums text-muted-foreground">×{record.attempts}</span>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              <RawLogStatus raw_status={record.raw_status} raw_available={record.raw_available} />
            </p>
            {record.status === "awaiting_link" ? (
              <p className="text-xs text-muted-foreground">{tx("awaitingLinkHint")}</p>
            ) : null}
            {refusal ? (
              <>
                <p id={`log-retry-refusal-${record.id}`} className="text-xs text-muted-foreground">
                  {tx(refusal)}
                </p>
                {record.status !== "done" && record.status !== "processing" ? (
                  <Button type="button" variant="outline" size="sm" disabled aria-describedby={`log-retry-refusal-${record.id}`}>
                    {t("retry")}
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>
        );
      }
    },
    {
      id: "error",
      header: t("error"),
      accessorFn: (record) => record.error_message ?? "",
      enableSorting: false,
      cell: ({ row }) => {
        const errorSummary = getErrorSummary(row.original);
        if (!errorSummary) return null;
        return (
          <details className="group max-w-[28rem]">
            <summary className={cn(
              "inline-flex cursor-pointer list-none items-center gap-1 rounded text-xs focus-visible:outline-2 focus-visible:outline-offset-2",
              row.original.status === "failed" ? "text-danger" : "text-muted-foreground"
            )}>
              <ChevronRight
                className="size-3 shrink-0 transition-transform group-open:rotate-90"
                aria-hidden
              />
              {errorSummary}
            </summary>
            <pre
              tabIndex={0}
              className="mt-1.5 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/20 p-2 text-xs text-muted-foreground"
            >
              {getErrorDetail(row.original)}
            </pre>
          </details>
        );
      }
    },
    {
      id: "created_at",
      header: t("uploaded"),
      accessorFn: (record) => record.created_at,
      size: 128,
      enableSorting: false,
      meta: columnMeta<LogProcessingRecord>({ align: "right", numeric: true }),
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {formatLogTime(format, row.original.created_at)}
        </span>
      )
    },
    {
      id: "duration",
      header: t("duration"),
      accessorFn: (record) => formatDuration(record),
      size: 88,
      enableSorting: false,
      meta: columnMeta<LogProcessingRecord>({ align: "right", numeric: true }),
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">{formatDuration(row.original)}</span>
      )
    },
    // Pending jobs can be requeued; an actively processing job cannot be retried.
    createKebabColumn<LogProcessingRecord>(
      (record) => [
        {
          label: getRetryKind(record) === "reparse"
            ? tx("reparseLog")
            : record.status === "failed" ? tx("retryLog") : tx("requeueLog"),
          icon: RotateCcw,
          hidden: !isRetryable(record),
          onSelect: () => {
            if (isRetryable(record)) retryMutation.mutate([record]);
          }
        },
        // An awaiting or failed job that kept its document teams is bound with an explicit team map; that is not
        // gated by the ordinary-retry refusal (a hint without a game is not an observation). Any other
        // unfinished one is only re-filed through a hint. A processed log already filed its match.
        // The workspace-wide console holds no encounter list: its dialog picks a tournament first.
        {
          label: tx("bindToGame"),
          icon: Link2,
          hidden: !canBindExplicitly(record) || (tournamentId != null && encounters.length === 0),
          onSelect: () => {
            if (canBindExplicitly(record)) setAttachTarget(record);
          }
        },
        {
          label: t("attachTo"),
          icon: Link2,
          hidden: record.status === "done" || record.status === "processing" || canBindExplicitly(record) || (tournamentId != null && encounters.length === 0) || getRetryRefusal(record) != null,
          onSelect: () => {
            if (getRetryRefusal(record) == null) setAttachTarget(record);
          }
        }
      ],
      { rowLabel: (record) => getLogFileName(record.filename) }
    )
  ];

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <FolderInput className="size-4 shrink-0 text-primary" aria-hidden />
            <h2 className="text-base font-semibold">{t("title")}</h2>
          </div>
          <p className="mt-1 text-pretty text-sm text-muted-foreground">
            {t("description")}
          </p>
        </div>

        {stats && stats.failed > 0 ? (
          <div className="flex flex-col gap-2 rounded-lg border border-danger/25 bg-danger/5 px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between">
            <p className="min-w-0 text-danger">
              {t("failedToProcess", { count: stats.failed })}
            </p>
            {statusFilter !== "failed" ? (
              <Button
                variant="outline"
                size="sm"
                className="h-7 shrink-0 text-xs"
                onClick={() => filters.set("status", "failed")}
              >
                {t("showFailed")}
              </Button>
            ) : null}
          </div>
        ) : null}

        <DataTable<LogProcessingRecord>
          columns={columns}
          getRowId={(record) => String(record.id)}
          initialPageSize={PAGE_SIZE}
          filterKey={filters.filterKey}
          cellAlign="top"
          searchPlaceholder={t("search")}
          emptyMessage={
            statusFilter != null
              ? tx("noStatusLogs")
              : tournamentId != null
                ? tx("noTournamentLogs")
                : tx("noWorkspaceLogs")
          }
          queryKey={(page, search, pageSize) => [
            ...historyKey,
            "list",
            statusFilter ?? "all",
            search.trim(),
            page,
            pageSize
          ]}
          queryFn={async (page, search, pageSize) => {
            const response = await adminService.getLogHistory(tournamentId ?? undefined, {
              limit: pageSize,
              offset: (page - 1) * pageSize,
              status: statusFilter ?? undefined,
              search: search.trim(),
              ...(tournamentId == null && { workspaceId })
            });
            return { results: response.items, total: response.total, page, per_page: pageSize };
          }}
          enableRowSelection={(row) => isRetryable(row.original)}
          bulkActions={(selected, clearSelection) => (
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled={retryMutation.isPending || !selected.some(isRetryable)}
              onClick={() => {
                const retryable = selected.filter(isRetryable);
                if (retryable.length > 0) {
                  retryMutation.mutate(retryable, { onSuccess: clearSelection });
                }
              }}
            >
              {retryMutation.isPending ? <Spinner /> : <RotateCcw aria-hidden />}
              {t("retry")} {selected.length}
            </Button>
          )}
          toolbar={
            <FilterBar
              defs={defs}
              filters={filters}
              trailing={
                stats ? (
                  <p className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                    {tx("summary", {
                      count: stats.total,
                      average:
                        stats.avg_duration_seconds != null
                          ? `${stats.avg_duration_seconds.toFixed(1)}s`
                          : "-"
                    })}
                    {stats.last_created_at
                      ? tx("newest", { time: formatLogTime(format, stats.last_created_at) })
                      : null}
                  </p>
                ) : null
              }
            />
          }
          actions={
            <>
              {canUploadLogs && tournamentId != null ? (
                <TournamentLogUploadDialog
                  tournamentId={tournamentId}
                  encounters={encounters}
                  onUploaded={() => {
                    invalidateTournamentWorkspace(queryClient, tournamentId);
                    refreshAll();
                  }}
                  trigger={
                    <Button variant="outline" size="sm" className="h-8">
                      {t("upload")}
                    </Button>
                  }
                />
              ) : null}
              {/* Both endpoints are per tournament, so the workspace-wide
                  console reads without offering them. */}
              {tournamentId != null ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  disabled={processAllLogsMutation.isPending}
                  onClick={() => processAllLogsMutation.mutate()}
                >
                  {processAllLogsMutation.isPending ? <Spinner /> : null}
                  {t("processS3")}
                </Button>
              ) : null}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label={t("refreshAria")}
                    onClick={refreshAll}
                    disabled={isFetching}
                  >
                    <RefreshCw className={cn(isFetching && "animate-spin")} aria-hidden />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("refresh")}</TooltipContent>
              </Tooltip>
            </>
          }
        />
      </div>
      {attachTarget ? (
        <AttachLogDialog
          key={attachTarget.id}
          record={attachTarget}
          encounters={encounters.filter((encounter) =>
            attachTarget.tournament_id == null || encounter.tournament_id === attachTarget.tournament_id
          )}
          pickTournament={tournamentId == null}
          historyKey={historyKey}
          workspaceId={workspaceId}
          isPending={attachMutation.isPending || bindMutation.isPending}
          onAttach={(encounterId, encounterGameId) =>
            attachMutation.mutate({ recordId: attachTarget.id, encounterId, encounterGameId })
          }
          onBind={(request) => bindMutation.mutate({ recordId: attachTarget.id, request })}
          onClose={() => setAttachTarget(null)}
        />
      ) : null}
    </TooltipProvider>
  );
}
