"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { DataTable } from "@/components/data-table";
import { FilterBar } from "@/components/kit/FilterBar";
import { Inspector } from "@/components/kit/Inspector";
import { useFilters } from "@/components/kit/useFilters";
import { useQueryParams } from "@/hooks/useQueryParams";
import { useFormatter } from "@/lib/datetime/client";
import { cn } from "@/lib/utils";
import { rbacService } from "@/services/rbac.service";
import type { AdminAuthSession, AdminSessionStatus } from "@/types/rbac.types";

import { sessionFilterDefs } from "./filters";
import { accountsHref, formatDeviceLabel, formatTimestamp } from "./model";
import { SessionInspectorPanel } from "./SessionInspectorPanel";
import { useSessionColumns } from "./useSessionColumns";

const PAGE_SIZE = 20;

/**
 * Auth sessions (T2, F15) — the superuser's read-only view of who is signed in
 * where.
 *
 * The status `<Select>` is now a URL chip, and the raw user agent and the
 * network address live in the inspector: they are what an investigation needs
 * and what made every row three lines tall. The session id stays in the row,
 * truncated, because it is how a session is named in a report.
 */
export function SessionsBrowser() {
  const t = useTranslations("adminAccess.common");
  const ts = useTranslations("adminAccess.sessionsUi");
  const format = useFormatter();
  const { searchParams, setParams } = useQueryParams({ resetOnChange: [], shallow: true });
  const openId = searchParams?.get("id") ?? null;

  const [pageRows, setPageRows] = useState<AdminAuthSession[]>([]);

  const defs = useMemo(() => sessionFilterDefs(t), [t]);
  const filters = useFilters(defs);
  const statusFilter = String(filters.values.status ?? "");

  const openRow = pageRows.find((row) => row.session_id === openId) ?? null;
  const openIndex = openRow ? pageRows.indexOf(openRow) : -1;

  const columns = useSessionColumns();

  return (
    <div className={cn("grid items-start gap-4", openRow && "lg:grid-cols-[minmax(0,1fr)_380px]")}>
      <div className="min-w-0">
        <DataTable<AdminAuthSession>
          columns={columns}
          initialPageSize={PAGE_SIZE}
          pageSizeOptions={[10, 20, 50, 100]}
          searchPlaceholder={ts("search")}
          filterKey={filters.filterKey}
          inspectorId={openId}
          getRowId={(row) => row.session_id}
          toolbar={<FilterBar defs={defs} filters={filters} />}
          emptyMessage={ts("noMatches")}
          onRowClick={(row) => setParams({ id: row.original.session_id })}
          renderMobileCard={(row) => (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {row.original.email ?? `account #${row.original.user_id}`}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {formatDeviceLabel(row.original.user_agent, t("unknownDevice"))}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {ts.rich("statusSummary", {
                  status: t(row.original.status),
                  time: formatTimestamp(format, row.original.last_seen_at, t("unavailable")),
                  num: (chunks) => <span className="tabular-nums">{chunks}</span>
                })}
              </p>
            </div>
          )}
          queryKey={(page, search, pageSize, sortField, sortDir) => [
            "access-admin",
            "sessions",
            page,
            search,
            pageSize,
            sortField,
            sortDir,
            statusFilter
          ]}
          queryFn={(page, search, pageSize, sortField, sortDir) =>
            rbacService.listSessions({
              page,
              per_page: pageSize,
              sort: sortField ?? undefined,
              order: sortDir,
              search: search || undefined,
              status: (statusFilter || undefined) as AdminSessionStatus | undefined
            })
          }
          onPageRowsChange={setPageRows}
        />
      </div>

      <Inspector
        openId={openRow ? openId : null}
        onClose={() => setParams({ id: null })}
        title={openRow ? (openRow.email ?? `Account #${openRow.user_id}`) : ""}
        subtitle={openRow ? formatDeviceLabel(openRow.user_agent, t("unknownDevice")) : undefined}
        openHref={openRow ? accountsHref(openRow) : undefined}
        onPrev={
          openIndex > 0
            ? () => setParams({ id: pageRows[openIndex - 1].session_id })
            : undefined
        }
        onNext={
          openIndex >= 0 && openIndex < pageRows.length - 1
            ? () => setParams({ id: pageRows[openIndex + 1].session_id })
            : undefined
        }
      >
        {openRow ? <SessionInspectorPanel session={openRow} /> : null}
      </Inspector>
    </div>
  );
}
