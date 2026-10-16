"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { AlertTriangle, HelpCircle } from "lucide-react";
import { useFormatter } from "@/lib/datetime/client";

import { StatusPill } from "@/components/kit/StatusPill";
import { EYEBROW_CLASS, TONE_CLASS, type Tone } from "@/components/kit/tone";
import { formatDate } from "@/components/kit/format-time";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import adminService from "@/services/admin.service";
import type { AdminMatchRow, LogProcessingStatus } from "@/types/admin.types";
import { adminQueryKeys } from "@/lib/admin/query-keys";

const STATUS_TONE: Record<LogProcessingStatus, Tone> = {
  pending: "neutral",
  processing: "info",
  awaiting_link: "neutral",
  done: "success",
  failed: "danger"
};

function Field({ label, value }: Readonly<{ label: string; value: string | number }>) {
  return (
    <div className="min-w-0">
      <p className={EYEBROW_CLASS}>{label}</p>
      <p className="truncate text-sm tabular-nums">{value}</p>
    </div>
  );
}

/**
 * Technical summary for one parsed map, with its provenance.
 *
 * The linked ingestion job identifies the raw log. A missing job means the
 * raw log is unavailable; never infer provenance from a filename.
 *
 * It renders the body only. The surrounding panel-or-sheet is `Inspector`,
 * which is where every T2 browser puts row detail; this used to own a `Sheet`
 * of its own, which meant the table was covered on a wide screen instead of
 * simply narrowing beside the detail.
 *
 * The row supplies everything the list already knows; only the aggregates are
 * fetched, and only while the detail is open.
 */
export function ParsedMatchDetail({
  row,
  workspaceId
}: Readonly<{
  row: AdminMatchRow;
  workspaceId: number | null;
}>) {
  const t = useTranslations("adminMatches.parsed");
  const format = useFormatter();
  const detailQuery = useQuery({
    queryKey: adminQueryKeys.matchDetail(row.id, workspaceId),
    queryFn: () => adminService.getAdminMatch(row.id, workspaceId!),
    enabled: workspaceId != null
  });

  const detail = detailQuery.data;
  const record = row.log_record;
  const duration = row.time == null
    ? "—"
    : `${Math.floor(row.time / 60)}m ${String(Math.round(row.time % 60)).padStart(2, "0")}s`;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field
          label={t("score")}
          value={`${row.home_team?.name ?? "?"} ${row.home_score} – ${row.away_score} ${row.away_team?.name ?? "?"}`}
        />
        <Field label={t("duration")} value={duration} />
        <Field label={t("rounds")} value={detailQuery.isLoading ? "…" : (detail?.rounds ?? "—")} />
      </div>

      <section className="rounded-xl border border-border/60 p-3">
        <p className={EYEBROW_CLASS}>{t("provenance")}</p>
        {record ? (
          <div className="mt-2 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone={STATUS_TONE[record.status]}>{record.status}</StatusPill>
              <span className="font-mono text-xs">{record.filename ?? "—"}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label={t("record")} value={`#${record.id}`} />
              <Field label={t("source")} value={record.source ?? "—"} />
              <Field label={t("uploader")} value={record.uploader_id ?? "—"} />
              <Field label={t("attempts")} value={record.attempts} />
              <Field label={t("started")} value={formatDate(format, record.started_at)} />
              <Field label={t("finished")} value={formatDate(format, record.finished_at)} />
            </div>
            {record.error_message ? (
              <p
                className={cn(
                  "flex items-start gap-2 rounded-md border p-2 text-xs",
                  TONE_CLASS.danger
                )}
              >
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span className="break-all">{record.error_message}</span>
              </p>
            ) : null}
          </div>
        ) : (
          // No linked raw log is distinct from a failed ingestion job.
          <div className="mt-2 space-y-1">
            <p className="flex items-center gap-2 text-sm">
              <HelpCircle className="size-4 text-muted-foreground" aria-hidden />
              {t("noRawLog")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("provenanceText")}
            </p>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border/60 p-3">
        <p className={EYEBROW_CLASS}>{t("parsedVolume")}</p>
        {detailQuery.isLoading ? (
          <Skeleton className="mt-2 h-10 w-full" />
        ) : (
          <div className="mt-2 grid grid-cols-3 gap-2">
            <Field label={t("statistics")} value={detail?.statistics_count ?? 0} />
            <Field label={t("killFeed")} value={detail?.kill_feed_count ?? 0} />
            <Field label={t("events")} value={detail?.event_count ?? 0} />
          </div>
        )}
        {detail != null && detail.statistics_count === 0 ? (
          // A map with no statistics parsed but a `done` record means the log
          // was accepted and yielded nothing — worth surfacing, since the
          // encounter will still count it as played.
          <p className="mt-2 text-xs text-warning">
            {t("noStats")}
          </p>
        ) : null}
      </section>
    </div>
  );
}
