"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { useQuery } from "@tanstack/react-query";
import { Globe, Lock } from "lucide-react";
import { useFormatter } from "@/lib/datetime/client";

import { DataTable } from "@/components/data-table";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AuditFieldDiff } from "@/components/kit/AuditTrail";
import {
  AUDIT_ENTITY_TYPES,
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
  useAuditTranslator
} from "@/components/kit/audit-log";
import { FilterBar } from "@/components/kit/FilterBar";
import { Inspector } from "@/components/kit/Inspector";
import { useFilters, type FilterDef } from "@/components/kit/useFilters";
import { EYEBROW_CLASS } from "@/components/kit/tone";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { usePermissions } from "@/hooks/usePermissions";
import { useQueryParams } from "@/hooks/useQueryParams";
import { cn } from "@/lib/utils";
import adminService from "@/services/admin.service";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type { AuditLogRead, AuditSortField } from "@/types/admin.types";
import { EmptyNote } from "@/components/kit/EmptyNote";

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

/**
 * Who did what, across the workspace.
 *
 * Six existing per-domain journals answer this inside their own domain; this one
 * answers it for role changes, API keys, tournament deletions and workspace
 * settings, which had no trail beyond stdout.
 *
 * Two writers used to share the query string — this page merged its filters onto
 * `window.location.search` by hand while `DataTable` wrote `page`/`search`
 * through the History API — and a filter change and a page change overwrote each
 * other depending on which landed last. Now the filters are a `useFilters`
 * chip set (one `router.replace` per change, which also drops `page` and `id`)
 * and the table keeps its own five names. Nothing else touches the URL.
 */
export default function AdminAuditPage() {
  const t = useTranslations("adminMatches.audit");
  const auditT = useAuditTranslator();
  const { isSuperuser, canAccessPermission, isLoaded } = usePermissions();
  const workspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);
  const format = useFormatter();
  // `id` is the inspector, not a filter: opening a row must not drop the page
  // the row sits on, so nothing resets here.
  const { searchParams, setParams } = useQueryParams({ resetOnChange: [], shallow: true });
  const openId = searchParams?.get("id") ?? null;

  const [pageRows, setPageRows] = useState<AuditLogRead[]>([]);

  // Read straight off the URL for the chips that have no closed option list:
  // they arrive from a link ("only this actor", the per-entity trail's "see it
  // in the feed") and are declared as filters only while they are set, so the
  // "+ Filter" picker never offers a control whose values it cannot enumerate.
  const entityIdParam = searchParams?.get("entity_id") ?? "";
  const actorParam = searchParams?.get("actor_user_id") ?? "";
  const actionParam = searchParams?.get("action") ?? "";

  const defs = useMemo<FilterDef[]>(() => {
    const list: FilterDef[] = [
      {
        key: "entity_type",
        label: t("entity"),
        kind: "single",
        options: AUDIT_ENTITY_TYPES.map((entityType) => ({
          value: entityType,
          label: auditEntityLabel(entityType, auditT) ?? entityType,
        })),
      },
    ];
    if (isSuperuser) {
      // Absent means "this workspace". The one option widens the feed to every
      // workspace plus the platform-level rows that belong to none.
      list.push({
        key: SCOPE_PARAM,
        label: t("scope"),
        kind: "single",
        options: [{ value: ALL_WORKSPACES, label: t("everyWorkspacePlatform") }],
      });
    }
    if (entityIdParam) {
      list.push({
        key: "entity_id",
        label: t("record"),
        kind: "single",
        options: [{ value: entityIdParam, label: `#${entityIdParam}` }],
      });
    }
    if (actorParam) {
      // Named from the rows on screen when they can name them: every row in an
      // actor-filtered feed has that actor, and "#12" says nothing to the reader
      // who is about to argue about it.
      const named = pageRows.find((row) => String(row.actor_auth_user_id) === actorParam);
      list.push({
        key: "actor_user_id",
        label: t("actor"),
        kind: "single",
        options: [
          { value: actorParam, label: named ? formatAuditActor(named, auditT) : `#${actorParam}` },
        ],
      });
    }
    if (actionParam) {
      list.push({
        key: "action",
        label: t("action"),
        kind: "single",
        options: [{ value: actionParam, label: describeAuditAction(actionParam, auditT).label }],
      });
    }
    return list;
  }, [isSuperuser, entityIdParam, actorParam, actionParam, pageRows, t, auditT]);

  const filters = useFilters(defs);
  // `filters` is a fresh object every render; its two writers are not. Pulled
  // out here so the column memo below depends on the callbacks themselves
  // rather than on the container that carries them.
  const { set: setFilter, setMany: setFilters } = filters;

  const entityType = String(filters.values.entity_type ?? "") || null;
  // `|| null` on the parse, not a guard function: `NaN || null` is `null`, so a
  // truncated or non-numeric param drops the filter rather than sending garbage.
  const entityId = Number.parseInt(String(filters.values.entity_id ?? ""), 10) || null;
  const actorUserId = Number.parseInt(String(filters.values.actor_user_id ?? ""), 10) || null;
  const action = String(filters.values.action ?? "") || null;
  // A superuser with no workspace picked has no narrower scope to fall back to,
  // so the feed IS platform-wide — the badge and the boundary note below have to
  // say so rather than claim a workspace they are not filtering by.
  const allWorkspaces =
    isSuperuser && (filters.values[SCOPE_PARAM] === ALL_WORKSPACES || workspaceId == null);

  const scopeWorkspaceId = allWorkspaces ? null : workspaceId;
  const allowed = canAccessPermission("audit.read", scopeWorkspaceId);

  /**
   * Filters that narrow *which rows* are in the feed, as opposed to which
   * workspace it covers. Only these change what an empty result means, so the
   * scope chip is deliberately not one of them.
   */
  const isNarrowed = entityType != null || entityId != null || actorUserId != null || action != null;

  // Skipped while a filter is on (only the unfiltered empty states quote the
  // journal's start date) and skipped when there is no scope to ask about, which
  // the endpoint answers with a 422 rather than a wider feed.
  const historyStart = useQuery({
    ...auditHistoryStartQuery({ workspaceId, allWorkspaces }),
    enabled: allowed && !isNarrowed && (isSuperuser || workspaceId != null),
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
    if (isNarrowed) {
      return t("noEntriesMatchFilters");
    }
    if (historyStart.data == null) {
      return allWorkspaces
        ? t("noEntriesYetAll")
        : t("noEntriesYetWorkspace");
    }
    return allWorkspaces
      ? t("noActivitySinceAll", { date: formatAuditDate(format, historyStart.data) })
      : t("noActivitySinceWorkspace", { date: formatAuditDate(format, historyStart.data) });
  })();

  const columns = useMemo<ColumnDef<AuditLogRead>[]>(
    () => [
      {
        accessorKey: "created_at",
        header: t("when"),
        size: 180,
        cell: ({ row }) => (
          <time
            dateTime={row.original.created_at}
            className="whitespace-nowrap text-sm tabular-nums text-muted-foreground"
          >
            {formatAuditTimestamp(format, row.original.created_at)}
          </time>
        ),
      },
      {
        accessorKey: "action",
        header: t("action"),
        cell: ({ row }) => {
          const described = describeAuditAction(row.original.action, auditT);
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
                <Badge tone="neutral" className="font-normal">
                  {t("unrecognised")}
                </Badge>
              )}
            </div>
          );
        },
      },
      {
        accessorKey: "actor_label",
        header: t("actor"),
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
              {formatAuditActor(row.original, auditT)}
            </p>
            {row.original.actor_auth_user_id != null ? (
              <button
                type="button"
                className="text-xs tabular-nums text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                onClick={() => setFilter("actor_user_id", String(row.original.actor_auth_user_id))}
              >
                {t("onlyActor")}
              </button>
            ) : null}
          </div>
        ),
      },
      {
        accessorKey: "entity_type",
        header: t("target"),
        cell: ({ row }) => {
          const target = formatAuditTarget(row.original, auditT);
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
                  // The type and the id are one filter in two params, so they go
                  // in one write — `set` twice would start from the same URL
                  // snapshot and only the second would survive.
                  onClick={() =>
                    setFilters({
                      entity_type: row.original.entity_type ?? null,
                      entity_id: String(row.original.entity_id),
                    })
                  }
                >
                  {t("onlyRecord")}
                </button>
              ) : null}
            </div>
          );
        },
      },
      {
        accessorKey: "source",
        header: t("source"),
        size: 132,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm text-muted-foreground">
            {auditSourceLabel(row.original.source, auditT)}
          </span>
        ),
      },
      {
        id: "changes",
        header: t("changes"),
        enableSorting: false,
        cell: ({ row }) => {
          const rows = auditDiffRows(row.original.before_json, row.original.after_json, auditT);
          if (rows.length === 0) {
            return (
              <span className="text-xs text-muted-foreground">
                {row.original.reason ? "reason only" : "no field detail"}
              </span>
            );
          }
          const named = rows.slice(0, 3).map((diff) => diff.field);
          return (
            <span
              className="text-xs text-muted-foreground"
              title={rows.map((diff) => diff.field).join(", ")}
            >
              <span className="font-mono">{named.join(", ")}</span>
              {rows.length > named.length ? ` ${t("moreFields", { count: rows.length - named.length })}` : ""}
            </span>
          );
        },
      },
    ],
    [format, setFilter, setFilters, t, auditT],
  );

  if (!isLoaded) return <Skeleton className="h-64 w-full rounded-xl" />;

  // A non-superuser request without a workspace is a 422, not a wider feed, so
  // there is nothing to ask for until one is picked. Asked before the permission
  // gate: without a scope there is no scope to hold a grant in, and "unauthorized"
  // would be the wrong thing to say to someone who has simply picked nothing.
  if (!isSuperuser && workspaceId == null) {
    return (
      <div className="space-y-6">
        <AdminPageHeader title={t("title")} description={t("description")} />
        <EmptyNote className="text-center">
          {t("scopeDescription")}
        </EmptyNote>
      </div>
    );
  }

  // The same grant `AuditTrailButton` asks for, in the scope this feed queries.
  // The server requires `audit.read` in the requested workspace, so without it
  // every request on this screen is a 403 — saying so once beats a table of them.
  if (!allowed) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("unauthorized")}</CardTitle>
          <CardDescription>
            {t("noPermission")}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const openRow = pageRows.find((row) => String(row.id) === openId) ?? null;
  const openIndex = openRow ? pageRows.indexOf(openRow) : -1;
  const openAction = openRow ? describeAuditAction(openRow.action, auditT) : null;
  const openTarget = openRow ? formatAuditTarget(openRow, auditT) : null;
  const openMeta: Array<{ label: string; value: string }> = openRow
    ? [
        { label: t("source"), value: auditSourceLabel(openRow.source, auditT) },
        {
          label: t("workspace"),
          value:
            openRow.workspace_id == null
              ? t("everyWorkspace")
              : `#${openRow.workspace_id}`,
        },
        ...(openRow.ip_address ? [{ label: t("ipAddress"), value: openRow.ip_address }] : []),
        ...(openRow.user_agent ? [{ label: t("userAgent"), value: openRow.user_agent }] : []),
        ...(openRow.correlation_id
          ? [{ label: t("correlationId"), value: openRow.correlation_id }]
          : []),
        { label: t("entry"), value: `#${openRow.id}` },
      ]
    : [];

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={t("title")}
        description={t("readOnlyDescription")}
        meta={
          allWorkspaces ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Globe aria-hidden className="size-3.5" />
              {t("everyWorkspace")}
            </span>
          ) : null
        }
      />

      <div
        className={cn("grid items-start gap-4", openRow && "lg:grid-cols-[minmax(0,1fr)_380px]")}
      >
        <div className="min-w-0">
          <DataTable<AuditLogRead>
            columns={columns}
            initialPageSize={PAGE_SIZE}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            initialSort={{ field: "created_at", dir: "desc" }}
            filterKey={`${filters.filterKey}|${allWorkspaces}|${workspaceId}`}
            inspectorId={openId}
            getRowId={(row) => String(row.id)}
            searchPlaceholder={t("search")}
            emptyMessage={emptyMessage}
            toolbar={<FilterBar defs={defs} filters={filters} />}
            onRowClick={(row) => setParams({ id: String(row.original.id) })}
            renderMobileCard={(row) => (
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {describeAuditAction(row.original.action, auditT).label}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {formatAuditActor(row.original, auditT)}
                  {formatAuditTarget(row.original, auditT) ? ` · ${formatAuditTarget(row.original, auditT)}` : ""}
                </p>
                <p className="text-xs tabular-nums text-muted-foreground">
                  {formatAuditTimestamp(format, row.original.created_at)}
                </p>
              </div>
            )}
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
                workspace_id: scopeWorkspaceId,
                allWorkspaces,
              })
            }
            onPageRowsChange={setPageRows}
          />
        </div>

        <Inspector
          openId={openRow ? openId : null}
          onClose={() => setParams({ id: null })}
          title={openAction?.label ?? ""}
          subtitle={
            openRow
              ? t(openTarget ? "inspectorSubtitleWithTarget" : "inspectorSubtitle", {
                  time: formatAuditTimestamp(format, openRow.created_at),
                  actor: formatAuditActor(openRow, auditT),
                  target: openTarget ?? ""
                })
              : undefined
          }
          onPrev={
            openIndex > 0 ? () => setParams({ id: String(pageRows[openIndex - 1].id) }) : undefined
          }
          onNext={
            openIndex >= 0 && openIndex < pageRows.length - 1
              ? () => setParams({ id: String(pageRows[openIndex + 1].id) })
              : undefined
          }
        >
          {openRow ? (
            <div className="space-y-4">
              {openRow.reason ? (
                <div className="space-y-1">
                  <h3 className={EYEBROW_CLASS}>{t("reason")}</h3>
                  <p className="text-sm">{openRow.reason}</p>
                </div>
              ) : null}

              <div className="space-y-1.5">
                <h3 className={EYEBROW_CLASS}>{t("changes")}</h3>
                <AuditFieldDiff before={openRow.before_json} after={openRow.after_json} />
              </div>

              <dl className="grid gap-x-4 gap-y-1.5 border-t border-border/40 pt-3 text-xs">
                {openMeta.map((item) => (
                  <div key={item.label} className="flex min-w-0 items-baseline gap-1.5">
                    <dt className="shrink-0 text-muted-foreground">{item.label}:</dt>
                    <dd className="min-w-0 break-all font-mono text-foreground/80">
                      {item.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
        </Inspector>
      </div>

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
          <span>{t("allWorkspaceRows")}</span>
        ) : (
          <span>{t("workspaceRows")}</span>
        )}
      </p>
    </div>
  );
}
