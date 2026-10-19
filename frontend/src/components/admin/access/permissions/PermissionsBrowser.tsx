"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";

import { DataTable } from "@/components/data-table";
import { FilterBar } from "@/components/kit/FilterBar";
import { Inspector } from "@/components/kit/Inspector";
import { useFilters } from "@/components/kit/useFilters";
import { PageStateCard } from "@/components/ui/page-state-card";
import { useQueryParams } from "@/hooks/useQueryParams";
import { cn } from "@/lib/utils";
import { rbacService } from "@/services/rbac.service";
import type { RbacPermission } from "@/types/rbac.types";
import { accessQueryKeys } from "@/lib/access/query-keys";

import { usePermissionFilterDefs } from "./filters";
import { PermissionInspectorPanel } from "./PermissionInspectorPanel";
import { usePermissionColumns } from "./usePermissionColumns";

const PAGE_SIZE = 20;

/**
 * The permission inventory (T2, F15) — read-only, and the vocabulary every
 * role and API key is built from.
 *
 * Fetched whole (roughly ninety rows) and paged client-side, because the
 * endpoint filters only by free text: deriving the resource and action chips
 * needs the full set anyway, and once it is in memory a second round-trip per
 * chip buys nothing.
 */
export function PermissionsBrowser() {
  const t = useTranslations("adminAccess.common");
  const tp = useTranslations("adminAccess.permissionsUi");
  const { searchParams, setParams } = useQueryParams({ resetOnChange: [], shallow: true });
  const openId = searchParams?.get("id") ?? null;

  const permissionsQuery = useQuery({
    queryKey: accessQueryKeys.permissionsInventory(),
    queryFn: () => rbacService.listPermissionsAll()
  });
  const permissions = useMemo(() => permissionsQuery.data ?? [], [permissionsQuery.data]);

  const defs = usePermissionFilterDefs(permissions);
  const filters = useFilters(defs);
  const resourceFilter = String(filters.values.resource ?? "");
  const actionFilter = String(filters.values.action ?? "");

  const rows = permissions.filter(
    (permission) =>
      (!resourceFilter || permission.resource === resourceFilter) &&
      (!actionFilter || permission.action === actionFilter)
  );

  const openRow = rows.find((permission) => String(permission.id) === openId) ?? null;
  const openIndex = openRow ? rows.indexOf(openRow) : -1;

  const columns = usePermissionColumns();

  if (permissionsQuery.isError) {
    return (
      <PageStateCard
        state="error"
        title={tp("loadError")}
        onAction={() => void permissionsQuery.refetch()}
        actionLabel={t("tryAgain")}
      />
    );
  }

  return (
    <div className={cn("grid items-start gap-4", openRow && "lg:grid-cols-[minmax(0,1fr)_380px]")}>
      <div className="min-w-0">
        <DataTable<RbacPermission>
          rows={rows}
          isLoading={permissionsQuery.isLoading}
          columns={columns}
          initialPageSize={PAGE_SIZE}
          pageSizeOptions={[10, 20, 50, 100]}
          searchPlaceholder={t("searchPermissions")}
          filterKey={filters.filterKey}
          inspectorId={openId}
          getRowId={(row) => String(row.id)}
          toolbar={<FilterBar defs={defs} filters={filters} />}
          emptyMessage={tp("noMatches")}
          onRowClick={(row) => setParams({ id: String(row.original.id) })}
        />
      </div>

      <Inspector
        openId={openRow ? openId : null}
        onClose={() => setParams({ id: null })}
        title={openRow ? openRow.name : ""}
        subtitle={openRow ? `${openRow.resource} · ${openRow.action}` : undefined}
        onPrev={openIndex > 0 ? () => setParams({ id: String(rows[openIndex - 1].id) }) : undefined}
        onNext={
          openIndex >= 0 && openIndex < rows.length - 1
            ? () => setParams({ id: String(rows[openIndex + 1].id) })
            : undefined
        }
      >
        {openRow ? <PermissionInspectorPanel permission={openRow} /> : null}
      </Inspector>
    </div>
  );
}
