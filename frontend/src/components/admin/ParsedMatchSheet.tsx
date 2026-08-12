"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, HelpCircle } from "lucide-react";

import { TONE_CLASS, type Tone } from "@/components/admin/tone";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import adminService from "@/services/admin.service";
import type { AdminMatchRow, LogProcessingStatus } from "@/types/admin.types";

const STATUS_TONE: Record<LogProcessingStatus, Tone> = {
  pending: "neutral",
  processing: "info",
  done: "success",
  failed: "danger"
};

function Field({ label, value }: Readonly<{ label: string; value: string | number }>) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
        {label}
      </p>
      <p className="truncate text-sm tabular-nums">{value}</p>
    </div>
  );
}

/**
 * Technical summary for one parsed map, with its provenance.
 *
 * The provenance block is the reason this exists: `Encounter.has_logs` said a
 * log existed somewhere, never which upload produced which map. Since
 * `mtchlog001` that is a foreign key rather than a filename comparison, so the
 * answer is either a specific record or an honest "unresolved" — the sheet
 * never guesses.
 *
 * The row supplies everything the list already knows; only the aggregates are
 * fetched, and only while the sheet is open.
 */
export function ParsedMatchSheet({
  row,
  workspaceId,
  open,
  onOpenChange
}: Readonly<{
  row: AdminMatchRow | null;
  workspaceId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}>) {
  const detailQuery = useQuery({
    queryKey: ["admin-matches", "detail", row?.id, workspaceId],
    queryFn: () => adminService.getAdminMatch(row!.id, workspaceId!),
    enabled: open && row != null && workspaceId != null
  });

  if (!row) return null;

  const detail = detailQuery.data;
  const record = row.log_record;
  const minutes = Math.floor(row.time / 60);
  const seconds = Math.round(row.time % 60);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{row.map_name}</SheetTitle>
          <SheetDescription>
            {row.encounter_name} &middot; {row.tournament_name}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Score"
              value={`${row.home_team.name ?? "?"} ${row.home_score} – ${row.away_score} ${row.away_team.name ?? "?"}`}
            />
            <Field label="Duration" value={`${minutes}m ${String(seconds).padStart(2, "0")}s`} />
            <Field label="Match code" value={row.code ?? "—"} />
            <Field label="Rounds" value={detailQuery.isLoading ? "…" : (detail?.rounds ?? "—")} />
          </div>

          <section className="rounded-xl border border-border/60 p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Provenance
            </p>
            {record ? (
              <div className="mt-2 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={cn(TONE_CLASS[STATUS_TONE[record.status]])}>
                    {record.status}
                  </Badge>
                  <span className="font-mono text-xs">{record.filename}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Record" value={`#${record.id}`} />
                  <Field label="Source" value={record.source ?? "—"} />
                  <Field label="Uploader" value={record.uploader_id ?? "—"} />
                  <Field label="Attempts" value={record.attempts} />
                  <Field
                    label="Started"
                    value={record.started_at ? new Date(record.started_at).toLocaleString() : "—"}
                  />
                  <Field
                    label="Finished"
                    value={record.finished_at ? new Date(record.finished_at).toLocaleString() : "—"}
                  />
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
              // Not an error state. The ingestion table postdates most parsed
              // matches, so the overwhelming majority of history lands here and
              // dressing it as a failure would bury the ones that really failed.
              <div className="mt-2 space-y-1">
                <p className="flex items-center gap-2 text-sm">
                  <HelpCircle className="size-4 text-muted-foreground" aria-hidden />
                  Provenance unresolved
                </p>
                <p className="text-xs text-muted-foreground">
                  No ingestion record is linked to this map. Matches parsed before the ingestion
                  table existed have none — the backfill left them unlinked rather than guessing
                  from the filename.
                </p>
                <p className="font-mono text-xs text-muted-foreground">{row.log_name}</p>
              </div>
            )}
          </section>

          <section className="rounded-xl border border-border/60 p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Parsed volume
            </p>
            {detailQuery.isLoading ? (
              <Skeleton className="mt-2 h-10 w-full" />
            ) : (
              <div className="mt-2 grid grid-cols-3 gap-2">
                <Field label="Statistics" value={detail?.statistics_count ?? 0} />
                <Field label="Kill feed" value={detail?.kill_feed_count ?? 0} />
                <Field label="Events" value={detail?.event_count ?? 0} />
              </div>
            )}
            {detail != null && detail.statistics_count === 0 ? (
              // A map with no statistics parsed but a `done` record means the
              // log was accepted and yielded nothing — worth surfacing, since
              // the encounter will still count it as played.
              <p className="mt-2 text-xs text-warning">
                No player statistics were written for this map.
              </p>
            ) : null}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
