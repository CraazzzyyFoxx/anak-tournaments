"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, History, LoaderCircle, Lock } from "lucide-react";

import {
  auditDiffRows,
  auditEntityLabel,
  auditHistoryStartQuery,
  auditSourceLabel,
  describeAuditAction,
  formatAuditActor,
  formatAuditDate,
  formatAuditTimestamp,
  hasUncapturedBefore,
  isMachineActor,
  type AuditDiffKind,
} from "@/components/admin/audit-log";
import { EYEBROW_CLASS } from "@/components/admin/tone";
import { Badge } from "@/components/ui/badge";
import { ApiError } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import adminService from "@/services/admin.service";
import type { AuditLogRead } from "@/types/admin.types";

/** One screenful. Anything deeper belongs in the feed, which paginates. */
const TRAIL_PAGE_SIZE = 10;

/**
 * Per-line marker for the field diff.
 *
 * The symbol and the screen-reader word carry the difference; the colour only
 * reinforces it. Colour-only encoding is out of bounds — `docs/design-book.md`
 * ("никогда color-only") — and this diff is read on exactly the occasions
 * someone is checking whether a value was raised or lowered.
 */
const DIFF_LINES: Record<
  AuditDiffKind,
  Array<{ side: "before" | "after"; symbol: string; word: string; className: string }>
> = {
  added: [{ side: "after", symbol: "+", word: "added", className: "text-success" }],
  removed: [{ side: "before", symbol: "\u2212", word: "removed", className: "text-danger" }],
  set: [{ side: "after", symbol: "\u2192", word: "set to", className: "text-info" }],
  changed: [
    { side: "before", symbol: "\u2212", word: "was", className: "text-danger" },
    { side: "after", symbol: "+", word: "now", className: "text-success" },
  ],
};

const DIFF_KIND_WORD: Record<AuditDiffKind, string> = {
  added: "added",
  removed: "removed",
  changed: "changed",
  set: "set",
};

/**
 * Field-level diff of a row's `before_json` / `after_json`.
 *
 * Writers assemble both sides from named domain fields rather than capturing the
 * request, so a field missing from a populated side is a fact worth its own
 * wording instead of a hole in the capture.
 */
export function AuditFieldDiff({
  before,
  after,
}: Readonly<{
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}>) {
  const rows = auditDiffRows(before, after);

  if (rows.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No field-level changes were captured for this entry.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      <dl className="space-y-1.5">
        {rows.map((row) => (
          <div key={row.field} className="grid gap-0.5">
            <dt className="flex items-baseline gap-1.5">
              <span className="font-mono text-xs text-foreground">{row.field}</span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {DIFF_KIND_WORD[row.kind]}
              </span>
            </dt>
            <dd className="grid gap-0.5">
              {DIFF_LINES[row.kind].map((line) => (
                <span key={line.side} className="flex items-baseline gap-1.5 font-mono text-xs">
                  <span aria-hidden className={cn("w-3 shrink-0 text-center", line.className)}>
                    {line.symbol}
                  </span>
                  <span className="sr-only">{line.word}:</span>
                  <span className="min-w-0 break-all text-muted-foreground">
                    {line.side === "before" ? row.before : row.after}
                  </span>
                </span>
              ))}
            </dd>
          </div>
        ))}
      </dl>
      {hasUncapturedBefore(rows) ? (
        // Said once, rather than dressed up per field as "added": a
        // service-backed update stages the requested values with no before-image,
        // so the previous values are genuinely not on record. Anyone comparing
        // two entries needs to know that before drawing a conclusion from them.
        <p className="text-xs text-muted-foreground">
          Only the values this action set are on record; the previous ones are not.
        </p>
      ) : null}
    </div>
  );
}

/** Everything the compact line leaves out, shown only when asked for. */
function AuditEntryDetail({ entry }: Readonly<{ entry: AuditLogRead }>) {
  const meta: Array<{ label: string; value: string }> = [
    { label: "Source", value: auditSourceLabel(entry.source) },
    ...(entry.ip_address ? [{ label: "IP", value: entry.ip_address }] : []),
    ...(entry.user_agent ? [{ label: "Device", value: entry.user_agent }] : []),
    ...(entry.correlation_id ? [{ label: "Correlation", value: entry.correlation_id }] : []),
  ];

  return (
    <div className="mt-2 space-y-2 rounded-md border border-border/50 bg-muted/20 p-2.5">
      {entry.reason ? (
        <p className="text-xs text-foreground">
          <span className="text-muted-foreground">Reason: </span>
          {entry.reason}
        </p>
      ) : null}

      <AuditFieldDiff before={entry.before_json} after={entry.after_json} />

      <dl className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border/40 pt-2 text-xs text-muted-foreground">
        {meta.map((item) => (
          <div key={item.label} className="flex min-w-0 items-baseline gap-1">
            <dt>{item.label}:</dt>
            <dd className="min-w-0 truncate font-mono text-foreground/80" title={item.value}>
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function AuditEntry({ entry }: Readonly<{ entry: AuditLogRead }>) {
  const [open, setOpen] = useState(false);
  const action = describeAuditAction(entry.action);
  const hasDetail =
    entry.before_json != null ||
    entry.after_json != null ||
    entry.reason != null ||
    entry.ip_address != null ||
    entry.correlation_id != null;

  return (
    <li className="py-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <time
          dateTime={entry.created_at}
          className="shrink-0 tabular-nums text-xs text-muted-foreground"
        >
          {formatAuditTimestamp(entry.created_at)}
        </time>
        <span
          className="text-sm font-medium text-foreground"
          title={action.recognised ? undefined : action.raw}
        >
          {action.label}
        </span>
        {action.recognised ? null : (
          // A phrase we had to derive from the string must not pass for a curated
          // one: the reader needs to know the wording is a guess, not a fact.
          <Badge variant="outline" className="border-border/60 font-normal text-muted-foreground">
            unrecognised action
          </Badge>
        )}
        <span className="text-xs text-muted-foreground">
          by{" "}
          <span className={cn("text-foreground", isMachineActor(entry) && "italic")}>
            {formatAuditActor(entry)}
          </span>
        </span>

        {hasDetail ? (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
            className="ml-auto flex shrink-0 items-center gap-1 rounded text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {open ? "Hide details" : "Details"}
            <ChevronDown
              aria-hidden
              className={cn("size-3.5 transition-transform", open && "rotate-180")}
            />
          </button>
        ) : null}
      </div>

      {open ? <AuditEntryDetail entry={entry} /> : null}
    </li>
  );
}

export interface AuditTrailProps {
  /** Matches the `entity_type` the writers pair with this entity's actions. */
  entityType: string;
  entityId: number;
  /**
   * The workspace the entity belongs to — passed explicitly rather than left to
   * the ambient one, so a trail on an entity page reads the same journal the
   * mutation was authorized against.
   */
  workspaceId: number;
}

/**
 * "Who changed this" for a single entity, mounted on its own page.
 *
 * Same endpoint as the feed (FR6), scoped to this entity. A compact list rather
 * than a table: it lives inside a settings page, and one entity's history is
 * read top-to-bottom, not sorted and filtered.
 */
export function AuditTrail({ entityType, entityId, workspaceId }: Readonly<AuditTrailProps>) {
  const entityNoun = (auditEntityLabel(entityType) ?? "record").toLowerCase();

  const trailQuery = useQuery({
    queryKey: ["admin", "audit", "trail", workspaceId, entityType, entityId],
    queryFn: () =>
      adminService.listAudit({
        workspace_id: workspaceId,
        entity_type: entityType,
        entity_id: entityId,
        per_page: TRAIL_PAGE_SIZE,
      }),
    retry: false,
  });

  // Only asked for once the trail comes back empty, because that is the only
  // case whose wording depends on it.
  const historyStart = useQuery({
    ...auditHistoryStartQuery({ workspaceId }),
    enabled: trailQuery.data?.results.length === 0,
    retry: false,
  });

  const total = trailQuery.data?.total ?? 0;
  const entries = trailQuery.data?.results ?? [];
  const feedHref = `/admin/audit?entity_type=${encodeURIComponent(entityType)}&entity_id=${entityId}`;

  return (
    <section className="rounded-xl border border-border/50 bg-card/50">
      <header className="flex items-center gap-2 border-b border-border/40 px-4 py-2.5">
        <History aria-hidden className="size-4 text-muted-foreground" />
        <h2 className={EYEBROW_CLASS}>Change history</h2>
        {total > 0 ? (
          <span className="text-xs tabular-nums text-muted-foreground">{total} recorded</span>
        ) : null}
        {trailQuery.isFetching ? (
          <span role="status" className="flex items-center text-muted-foreground">
            <LoaderCircle aria-hidden className="size-3 animate-spin" />
            <span className="sr-only">Loading change history…</span>
          </span>
        ) : null}
        {total > entries.length ? (
          <Link
            href={feedHref}
            className="ml-auto shrink-0 text-xs text-primary underline-offset-2 hover:underline"
          >
            All {total} entries <span aria-hidden>→</span>
          </Link>
        ) : null}
      </header>

      <div className="px-4 py-3">
        {trailQuery.isLoading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : trailQuery.isError ? (
          renderTrailError(trailQuery.error, entityNoun)
        ) : entries.length > 0 ? (
          <ul className="divide-y divide-border/30">
            {entries.map((entry) => (
              <AuditEntry key={entry.id} entry={entry} />
            ))}
          </ul>
        ) : historyStart.isLoading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : historyStart.data ? (
          // Empty state 1 of 3: the journal runs, this entity is simply older
          // than it. There is no backfill, so for the first months this is the
          // common case — and saying only "no changes" here would assert that
          // nobody touched the record, which is the one claim the audit log
          // exists to be able to make truthfully.
          <p className="text-xs text-muted-foreground">
            No changes recorded for this {entityNoun}. The audit log in this workspace starts on{" "}
            <span className="text-foreground">{formatAuditDate(historyStart.data)}</span> — anything
            done before that date left no trail.
          </p>
        ) : (
          // Empty state 2 of 3: nothing anywhere in this workspace yet, so there
          // is no start date to quote and no claim to make about this entity.
          <p className="text-xs text-muted-foreground">
            The audit log has no entries in this workspace yet. It records admin actions from the
            moment it was switched on, so history begins with the next change.
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * Empty state 3 of 3 lives here: a refusal is not an absence of history.
 *
 * `entity_type` + `entity_id` filter INSIDE the reader's workspace scope rather
 * than reaching around it, so pointing a trail at another tenant's entity is a
 * refusal or an empty page — never their history. Reading that refusal as "no
 * changes" would be the same false reassurance the empty states above avoid.
 */
function renderTrailError(error: unknown, entityNoun: string) {
  const status = error instanceof ApiError ? error.status : 0;

  if (status === 401 || status === 403) {
    return (
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Lock aria-hidden className="mt-px size-3.5 shrink-0" />
        <span>
          You do not have access to the audit log for this workspace, so this {entityNoun}&rsquo;s
          history is hidden rather than empty. Ask an owner for the audit read permission.
        </span>
      </p>
    );
  }

  return (
    <p className="text-xs text-danger">
      The change history could not be loaded
      {error instanceof Error && error.message ? `: ${error.message}` : "."}
    </p>
  );
}
