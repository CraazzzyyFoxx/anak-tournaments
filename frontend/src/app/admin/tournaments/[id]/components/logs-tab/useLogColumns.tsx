"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { ChevronRight, Link2, RotateCcw } from "lucide-react";
import { useFormatter } from "@/lib/datetime/client";
import { columnMeta, createKebabColumn } from "@/components/data-table";
import { StatusPill } from "@/components/kit/StatusPill";
import { RawLogStatus } from "@/components/match/MatchLogIndicator";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { LogProcessingRecord, LogProcessingStatus } from "@/types/admin.types";
import { getLogFileName, getRetryKind } from "../logs.helpers";
import {
  SOURCE_LABELS,
  STATUS_META,
  canBindExplicitly,
  formatDuration,
  formatLogTime,
  getErrorDetail,
  getErrorSummary,
  getRetryRefusal,
  isRetryable
} from "./model";

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

/** The log job row: what was filed, where it landed, how processing went, and what can be done about it. */
export function useLogColumns({
  noEncounters,
  onRetry,
  onAttach
}: Readonly<{
  /** The hub has no encounter to file a log under; the workspace console picks a tournament instead. */
  noEncounters: boolean;
  /** Stable identity required: the kebab column closes over both. */
  onRetry: (records: LogProcessingRecord[]) => void;
  onAttach: (record: LogProcessingRecord) => void;
}>): ColumnDef<LogProcessingRecord>[] {
  const t = useTranslations("adminTournament.logs");
  const tx = useTranslations("adminTournament.logsExtra");
  const format = useFormatter();
  return useMemo<ColumnDef<LogProcessingRecord>[]>(
    () => [
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
              if (isRetryable(record)) onRetry([record]);
            }
          },
          // An awaiting or failed job that kept its document teams is bound with an explicit team map; that is not
          // gated by the ordinary-retry refusal (a hint without a game is not an observation). Any other
          // unfinished one is only re-filed through a hint. A processed log already filed its match.
          // The workspace-wide console holds no encounter list: its dialog picks a tournament first.
          {
            label: tx("bindToGame"),
            icon: Link2,
            hidden: !canBindExplicitly(record) || noEncounters,
            onSelect: () => {
              if (canBindExplicitly(record)) onAttach(record);
            }
          },
          {
            label: t("attachTo"),
            icon: Link2,
            hidden: record.status === "done" || record.status === "processing" || canBindExplicitly(record) || noEncounters || getRetryRefusal(record) != null,
            onSelect: () => {
              if (getRetryRefusal(record) == null) onAttach(record);
            }
          }
        ],
        { rowLabel: (record) => getLogFileName(record.filename) }
      )
    ],
    [noEncounters, onRetry, onAttach, format, t, tx]
  );
}
