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
import { useBracketRoundLabel } from "@/hooks/useBracketRoundLabel";

import { columnMeta, createKebabColumn, DataTable } from "@/components/data-table";
import { StatusPill } from "@/components/kit/StatusPill";
import { type Tone } from "@/components/kit/tone";
import { RawLogStatus } from "@/components/match/MatchLogIndicator";
import type { DateFormatter } from "@/components/kit/format-time";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import SearchableImageSelect from "@/components/ui/searchable-image-select";
import { encounterScopeLabel } from "@/components/admin/encounters/EncounterCells";
import { UNKNOWN_ROUND_SHAPE } from "@/lib/bracket/round-name";
import { FilterBar } from "@/components/kit/FilterBar";
import { useFilters, type FilterDef } from "@/components/kit/useFilters";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useInvalidation } from "@/hooks/useInvalidation";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import adminService from "@/services/admin.service";
import encounterService from "@/services/encounter.service";
import { encounterQueryKeys } from "@/lib/encounters/query-keys";
import type {
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

function getLogFileName(filename: string) {
  return filename.split(/[\\/]/).at(-1) ?? filename;
}

function getRetryRefusal(record: LogProcessingRecord): "retryRawUnavailable" | "retryHistorical" | "retryUnbound" | null {
  if (!record.raw_available) return "retryRawUnavailable";
  if (record.source === "historical_reference") return "retryHistorical";
  if (record.status !== "awaiting_link" && record.attached_encounter_id != null && record.attached_encounter_game_id == null) {
    return "retryUnbound";
  }
  return null;
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

/** Two encounters of one pair share a name, so the stage and round tell them apart. */
function encounterOptionLabel(
  encounter: Encounter,
  formatRound: ReturnType<typeof useBracketRoundLabel>
) {
  return `${encounter.name} · ${encounterScopeLabel(encounter)} · ${formatRound(encounter.round, UNKNOWN_ROUND_SHAPE)}`;
}

function AttachLogDialog({
  record,
  encounters,
  isPending,
  onAttach,
  onClose
}: Readonly<{
  record: LogProcessingRecord;
  encounters: Encounter[];
  isPending: boolean;
  onAttach: (encounterId: number, encounterGameId: number) => void;
  onClose: () => void;
}>) {
  const t = useTranslations("adminTournament.logs");
  const formatRound = useBracketRoundLabel();
  const [value, setValue] = useState(
    record.attached_encounter_id != null ? String(record.attached_encounter_id) : undefined
  );
  const [gameId, setGameId] = useState(
    record.attached_encounter_game_id != null ? String(record.attached_encounter_game_id) : undefined
  );
  const encounterId = value === undefined ? undefined : Number(value);
  const gamesQuery = useQuery({
    queryKey: encounterQueryKeys.detail(encounterId),
    queryFn: () => encounterService.getEncounter(encounterId!),
    enabled: encounterId !== undefined
  });
  const games = gamesQuery.data?.games.filter((game) => game.state !== "cancelled") ?? [];
  const selectedGame = games.find((game) => String(game.id) === gameId);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (open) return;
        onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("attachTitle")}</DialogTitle>
          <DialogDescription className="break-all">
            {t("attachDescriptionWithFile", { filename: getLogFileName(record.filename) })}
          </DialogDescription>
        </DialogHeader>
        <SearchableImageSelect
          value={value}
          onValueChange={(next) => {
            setValue(next);
            setGameId(undefined);
          }}
          disabled={isPending}
          ariaLabel={t("pickEncounter")}
          options={encounters.map((encounter) => ({
            value: String(encounter.id),
            label: encounterOptionLabel(encounter, formatRound)
          }))}
          placeholder={t("pickEncounter")}
          searchPlaceholder={t("searchEncounter")}
          triggerClassName="h-9"
        />
        <SearchableImageSelect
          value={selectedGame ? String(selectedGame.id) : undefined}
          onValueChange={setGameId}
          options={games.map((game) => ({
            value: String(game.id),
            label: t("gameOption", {
              position: game.position,
              map: game.map?.name ?? t("unknownMap"),
              id: game.id
            })
          }))}
          placeholder={t("pickGame")}
          ariaLabel={t("pickGame")}
          searchPlaceholder={t("searchGame")}
          disabled={encounterId === undefined || gamesQuery.isFetching || gamesQuery.isError || isPending}
          triggerClassName="h-9"
        />
        {encounterId !== undefined && gamesQuery.isFetching ? (
          <p role="status" className="text-sm text-muted-foreground">{t("loadingGames")}</p>
        ) : gamesQuery.isError ? (
          <div role="alert" className="space-y-2 text-sm text-danger">
            <p>{t("gamesLoadFailed")}</p>
            <Button variant="outline" size="sm" onClick={() => void gamesQuery.refetch()}>
              {t("reloadGames")}
            </Button>
          </div>
        ) : encounterId !== undefined && gamesQuery.isSuccess && games.length === 0 ? (
          <p role="status" className="text-sm text-muted-foreground">{t("noGames")}</p>
        ) : null}
        <DialogFooter>
          <Button
            disabled={!selectedGame || gamesQuery.isFetching || gamesQuery.isError || isPending}
            onClick={() => {
              if (encounterId !== undefined && selectedGame) onAttach(encounterId, selectedGame.id);
            }}
          >
            {isPending ? <Spinner /> : <Link2 aria-hidden />}
            {t("attach")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
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

  const retryMutation = useMutation({
    mutationFn: async (recordIds: number[]) => {
      const results = await Promise.allSettled(
        recordIds.map((recordId) => adminService.retryLogRecord(recordId))
      );
      return results.filter((result) => result.status === "rejected").length;
    },
    onSuccess: (failedCount, recordIds) => {
      const queued = recordIds.length - failedCount;
      if (failedCount > 0) {
        notify.error(t("retryQueuedSummary", { queued, total: recordIds.length }), {
          description: tx("retryQueued", { count: failedCount })
        });
      } else {
        notify.success(
          queued === 1
            ? t("retryQueuedSingle")
            : t("retryQueuedPlural", { count: queued })
        );
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
        const errorSummary = getErrorSummary(row.original.error_message);
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
              {row.original.error_message}
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
          label: record.status === "failed" ? tx("retryLog") : tx("requeueLog"),
          icon: RotateCcw,
          hidden: record.status === "done" || record.status === "processing" || getRetryRefusal(record) != null,
          onSelect: () => {
            if (getRetryRefusal(record) == null) retryMutation.mutate([record.id]);
          }
        },
        // A processed log already filed its match; only an unfinished one can
        // be re-filed. The workspace-wide console holds no encounter list.
        {
          label: t("attachTo"),
          icon: Link2,
          hidden: record.status === "done" || record.status === "processing" || encounters.length === 0 || getRetryRefusal(record) != null,
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
          enableRowSelection={(row) => row.original.status !== "done" && row.original.status !== "processing" && getRetryRefusal(row.original) == null}
          bulkActions={(selected, clearSelection) => (
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled={retryMutation.isPending || !selected.some((record) => getRetryRefusal(record) == null)}
              onClick={() => {
                const retryable = selected.filter((record) => getRetryRefusal(record) == null);
                if (retryable.length > 0) {
                  retryMutation.mutate(
                    retryable.map((record) => record.id),
                    { onSuccess: clearSelection }
                  );
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
          isPending={attachMutation.isPending}
          onAttach={(encounterId, encounterGameId) =>
            attachMutation.mutate({ recordId: attachTarget.id, encounterId, encounterGameId })
          }
          onClose={() => setAttachTarget(null)}
        />
      ) : null}
    </TooltipProvider>
  );
}
