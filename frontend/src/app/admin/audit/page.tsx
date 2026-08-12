"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { useQuery } from "@tanstack/react-query";
import { Globe, Lock, X } from "lucide-react";

import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AuditFieldDiff } from "@/components/admin/AuditTrail";
import {
  auditDiffRows,
  auditEntityLabel,
  auditHistoryStartQuery,
  auditSourceLabel,
  describeAuditAction,
  formatAuditActor,
  formatAuditDate,
  formatAuditTarget,
  formatAuditTimestamp,
  isMachineActor,
} from "@/components/admin/audit-log";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePermissions } from "@/hooks/usePermissions";
import { cn } from "@/lib/utils";
import adminService from "@/services/admin.service";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type { AuditLogRead, AuditSortField } from "@/types/admin.types";

/** Server caps `per_page` at 200, so the selector must not offer more. */
const PAGE_SIZE = 25;
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 200];

/**
 * `sort` is a closed whitelist server-side — anything else is a 422 — so every
 * sortable column id has to BE one of these strings. Columns outside the set
 * (the target label, the change summary) declare `enableSorting: false`.
 */
const SORTABLE: Record<string, AuditSortField> = {
  created_at: "created_at",
  action: "action",
  source: "source",
  actor_label: "actor_label",
  entity_type: "entity_type",
};

const SCOPE_PARAM = "scope";
const ALL_WORKSPACES = "all";

function parseId(value: string | null): number | null {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** Everything the row omits, for the reader who clicked it. */
function AuditEntryDialog({
  entry,
  onOpenChange,
}: {
  entry: AuditLogRead | null;
  onOpenChange: (open: boolean) => void;
}) {
  if (!entry) return null;

  const action = describeAuditAction(entry.action);
  const target = formatAuditTarget(entry);
  const meta: Array<{ label: string; value: string }> = [
    { label: "Source", value: auditSourceLabel(entry.source) },
    {
      label: "Workspace",
      value: entry.workspace_id == null ? "Platform-level (no workspace)" : `#${entry.workspace_id}`,
    },
    ...(entry.ip_address ? [{ label: "IP address", value: entry.ip_address }] : []),
    ...(entry.user_agent ? [{ label: "User agent", value: entry.user_agent }] : []),
    ...(entry.correlation_id ? [{ label: "Correlation ID", value: entry.correlation_id }] : []),
    { label: "Entry", value: `#${entry.id}` },
  ];

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{action.label}</DialogTitle>
          <DialogDescription>
            {formatAuditTimestamp(entry.created_at)} &middot; by {formatAuditActor(entry)}
            {target ? ` · ${target}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto">
          {entry.reason ? (
            <div className="space-y-1">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Reason
              </h3>
              <p className="text-sm">{entry.reason}</p>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Changes
            </h3>
            <AuditFieldDiff before={entry.before_json} after={entry.after_json} />
          </div>

          <dl className="grid gap-x-4 gap-y-1.5 border-t border-border/40 pt-3 text-xs sm:grid-cols-2">
            {meta.map((item) => (
              <div key={item.label} className="flex min-w-0 items-baseline gap-1.5">
                <dt className="shrink-0 text-muted-foreground">{item.label}:</dt>
                <dd className="min-w-0 break-all font-mono text-foreground/80">{item.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Who did what, across the workspace.
 *
 * Six existing per-domain journals answer this inside their own domain; this one
 * answers it for role changes, API keys, tournament deletions and workspace
 * settings, which had no trail beyond stdout.
 */
export default function AdminAuditPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { isSuperuser } = usePermissions();
  const workspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);
  const [openEntry, setOpenEntry] = useState<AuditLogRead | null>(null);

  // Filters this page owns. The table owns `page`, `search`, `per_page`, `sort`
  // and `dir` and writes them straight through the History API, so these five
  // names stay clear of those.
  const entityType = searchParams.get("entity_type");
  const entityId = parseId(searchParams.get("entity_id"));
  const actorUserId = parseId(searchParams.get("actor_user_id"));
  const action = searchParams.get("action");
  // A superuser with no workspace picked has no narrower scope to fall back to,
  // so the feed IS platform-wide — the badge and the boundary note below have to
  // say so rather than claim a workspace they are not filtering by.
  const allWorkspaces =
    isSuperuser && (searchParams.get(SCOPE_PARAM) === ALL_WORKSPACES || workspaceId == null);

  /**
   * `replace`, never `push` — the table pushes only for a page change and
   * replaces for everything else (`AdminDataTable.tsx:224-228`), and its
   * `popstate` handler re-reads only its own keys. Pushing here would make Back
   * behave differently on this page than on the other nineteen.
   *
   * Merged onto `window.location.search` rather than onto `searchParams`: the
   * table's writes go through `history.replaceState`, which Next does not
   * observe, so the hook's snapshot can be missing a search term or page size
   * that is live in the URL — and building from it would silently drop them.
   *
   * Takes the whole patch rather than one key, because `router.replace` lands
   * asynchronously: two sequential single-key calls would both read the
   * pre-navigation URL and the second would overwrite the first.
   */
  const setFilters = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(patch)) {
      if (value == null || value === "") next.delete(key);
      else next.set(key, value);
    }
    // A narrower filter invalidates the page number the table is holding; it
    // resets to 1 itself via `filterKey`, so the stale param has to go too.
    next.delete("page");

    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const chips: Array<{ key: string; label: string }> = [
    ...(entityType
      ? [
          {
            key: "entity_type",
            label: entityId
              ? `${auditEntityLabel(entityType)} #${entityId}`
              : `${auditEntityLabel(entityType)}s`,
          },
        ]
      : []),
    ...(actorUserId ? [{ key: "actor_user_id", label: `Actor #${actorUserId}` }] : []),
    ...(action ? [{ key: "action", label: describeAuditAction(action).label }] : []),
  ];

  // Skipped while a filter is on (only the unfiltered empty states quote the
  // journal's start date) and skipped when there is no scope to ask about, which
  // the endpoint answers with a 422 rather than a wider feed.
  const historyStart = useQuery({
    ...auditHistoryStartQuery({ workspaceId, allWorkspaces }),
    enabled: chips.length === 0 && (isSuperuser || workspaceId != null),
    retry: false,
  });

  /**
   * Three empty states, because "nothing recorded" would be a different claim in
   * each and only one of them is ever true at a time. There is no backfill, so
   * for the journal's first months the third is the usual answer — and reading it
   * as "nobody touched anything" would be exactly the false reassurance this
   * feed exists to replace.
   */
  const emptyMessage = (() => {
    if (chips.length > 0) {
      return "No entries match these filters. Clear one of the chips above to widen the feed.";
    }
    if (historyStart.data == null) {
      return allWorkspaces
        ? "The audit log has no entries yet. It records admin actions from the moment it was switched on, so history begins with the next change."
        : "The audit log has no entries in this workspace yet. It records admin actions from the moment it was switched on, so history begins with the next change.";
    }
    return `No activity recorded${allWorkspaces ? "" : " in this workspace"} since the audit log started on ${formatAuditDate(historyStart.data)}. Anything done before that date left no trail — there is no backfill.`;
  })();

  const columns: ColumnDef<AuditLogRead>[] = [
    {
      accessorKey: "created_at",
      header: "When",
      size: 180,
      cell: ({ row }) => (
        <time
          dateTime={row.original.created_at}
          className="whitespace-nowrap text-sm tabular-nums text-muted-foreground"
        >
          {formatAuditTimestamp(row.original.created_at)}
        </time>
      ),
    },
    {
      accessorKey: "action",
      header: "Action",
      cell: ({ row }) => {
        const described = describeAuditAction(row.original.action);
        return (
          <div className="flex min-w-0 flex-wrap items-baseline gap-1.5">
            <span
              className="text-sm font-medium"
              title={described.recognised ? undefined : described.raw}
            >
              {described.label}
            </span>
            {described.recognised ? null : (
              // Never let a phrase we derived from the raw string pass for a
              // curated one: `action` is written from every service on the
              // platform, so this dictionary will always trail new call sites.
              <Badge
                variant="outline"
                className="border-border/60 font-normal text-muted-foreground"
              >
                unrecognised
              </Badge>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: "actor_label",
      header: "Actor",
      cell: ({ row }) => (
        <div className="min-w-0">
          {/* A machine actor is a fact, not a missing name (FR3), so it reads as
              one instead of as an em dash. */}
          <p
            className={cn(
              "truncate text-sm",
              isMachineActor(row.original) ? "italic text-muted-foreground" : "font-medium",
            )}
          >
            {formatAuditActor(row.original)}
          </p>
          {row.original.actor_auth_user_id != null ? (
            <button
              type="button"
              className="text-xs tabular-nums text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              onClick={() =>
                setFilters({ actor_user_id: String(row.original.actor_auth_user_id) })
              }
            >
              only this actor
            </button>
          ) : null}
        </div>
      ),
    },
    {
      accessorKey: "entity_type",
      header: "Target",
      cell: ({ row }) => {
        const target = formatAuditTarget(row.original);
        if (!target) {
          return <span className="text-sm text-muted-foreground">&mdash;</span>;
        }
        return (
          <div className="min-w-0">
            <p className="truncate text-sm" title={target}>
              {target}
            </p>
            {row.original.entity_type && row.original.entity_id != null ? (
              <button
                type="button"
                className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                onClick={() =>
                  setFilters({
                    entity_type: row.original.entity_type,
                    entity_id: String(row.original.entity_id),
                  })
                }
              >
                only this record
              </button>
            ) : null}
          </div>
        );
      },
    },
    {
      accessorKey: "source",
      header: "Source",
      size: 132,
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-sm text-muted-foreground">
          {auditSourceLabel(row.original.source)}
        </span>
      ),
    },
    {
      id: "changes",
      header: "Changes",
      enableSorting: false,
      cell: ({ row }) => {
        const rows = auditDiffRows(row.original.before_json, row.original.after_json);
        if (rows.length === 0) {
          return (
            <span className="text-xs text-muted-foreground">
              {row.original.reason ? "reason only" : "no field detail"}
            </span>
          );
        }
        const named = rows.slice(0, 3).map((diff) => diff.field);
        return (
          <span className="text-xs text-muted-foreground" title={rows.map((d) => d.field).join(", ")}>
            <span className="font-mono">{named.join(", ")}</span>
            {rows.length > named.length ? ` +${rows.length - named.length} more` : ""}
          </span>
        );
      },
    },
  ];

  // A non-superuser request without a workspace is a 422, not a wider feed, so
  // there is nothing to ask for until one is picked.
  if (!isSuperuser && workspaceId == null) {
    return (
      <div className="space-y-6">
        <AdminPageHeader title="Audit log" description="Who changed what, and when." />
        <p className="rounded-xl border border-dashed border-border/70 px-4 py-8 text-center text-sm text-muted-foreground">
          Pick a workspace to read its audit log. The feed is scoped to one workspace at a time —
          the same scope the actions in it were authorized against.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Audit log"
        description="Who changed what, and when. Read-only and append-only."
        meta={
          allWorkspaces ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Globe aria-hidden className="size-3.5" />
              Every workspace
            </span>
          ) : null
        }
        footer={
          chips.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Filtered by</span>
              {chips.map((chip) => (
                <Button
                  key={chip.key}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs"
                  aria-label={`Remove filter: ${chip.label}`}
                  onClick={() =>
                    // The id is meaningless without its type, so they clear together.
                    setFilters(
                      chip.key === "entity_type"
                        ? { entity_type: null, entity_id: null }
                        : { [chip.key]: null },
                    )
                  }
                >
                  {chip.label}
                  <X aria-hidden className="size-3" />
                </Button>
              ))}
            </div>
          ) : null
        }
      />

      <AdminDataTable
        initialPageSize={PAGE_SIZE}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        filterKey={`${allWorkspaces}-${entityType}-${entityId}-${actorUserId}-${action}-${workspaceId}`}
        queryKey={(page, search, pageSize, sortField, sortDir) => [
          "admin",
          "audit",
          "feed",
          allWorkspaces ? ALL_WORKSPACES : workspaceId,
          entityType,
          entityId,
          actorUserId,
          action,
          page,
          search,
          pageSize,
          sortField,
          sortDir,
        ]}
        queryFn={(page, search, pageSize, sortField, sortDir) =>
          adminService.listAudit({
            page,
            per_page: pageSize,
            // An unsortable column id would 422; the whitelist gate keeps the
            // request honest even if a column is added without checking.
            sort: sortField ? SORTABLE[sortField] : undefined,
            order: sortDir,
            search: search || undefined,
            entity_type: entityType,
            entity_id: entityId,
            actor_user_id: actorUserId,
            action,
            workspace_id: allWorkspaces ? null : workspaceId,
            allWorkspaces,
          })
        }
        columns={columns}
        searchPlaceholder="Search actor, action, source, or target…"
        emptyMessage={emptyMessage}
        onRowClick={(row) => setOpenEntry(row.original)}
        actions={
          isSuperuser ? (
            <Select
              value={allWorkspaces ? ALL_WORKSPACES : "workspace"}
              onValueChange={(value) =>
                setFilters({ [SCOPE_PARAM]: value === ALL_WORKSPACES ? ALL_WORKSPACES : null })
              }
            >
              <SelectTrigger className="w-52" aria-label="Audit log scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="workspace">This workspace</SelectItem>
                <SelectItem value={ALL_WORKSPACES}>Every workspace + platform</SelectItem>
              </SelectContent>
            </Select>
          ) : null
        }
      />

      {/*
        The boundary of the feed, stated in the feed.
        A workspace journal is not the platform's journal: a global role grant can
        hand someone power inside this workspace and still land on a row with no
        workspace, which an organizer cannot see. Left unsaid, that is silent
        incompleteness — and the person it affects should not learn about it from
        whoever they are arguing with.
      */}
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Lock aria-hidden className="mt-px size-3.5 shrink-0" />
        {allWorkspaces ? (
          <span>
            Showing every workspace plus platform-level rows — global roles and permissions, and
            account-level changes. Rows with no workspace are visible to superusers only.
          </span>
        ) : (
          <span>
            Showing actions in this workspace. Platform-level actions — global roles and
            permissions, and account-level changes such as deleting an account or unlinking a
            player — are not part of a workspace journal, even when their effect reaches inside one.
          </span>
        )}
      </p>

      <AuditEntryDialog
        entry={openEntry}
        onOpenChange={(open) => {
          if (!open) setOpenEntry(null);
        }}
      />
    </div>
  );
}
