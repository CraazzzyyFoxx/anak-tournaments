"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";

import { columnMeta } from "@/components/data-table";
import type { RbacPermission } from "@/types/rbac.types";

/** The permission row: its name and what it allows. Resource and action are the filters. */
export function usePermissionColumns(): ColumnDef<RbacPermission>[] {
  const t = useTranslations("adminAccess.common");
  return useMemo<ColumnDef<RbacPermission>[]>(
    () => [
      {
        accessorKey: "name",
        header: t("permission"),
        meta: columnMeta<RbacPermission>({
          searchValue: (permission) => `${permission.name} ${permission.description ?? ""}`
        }),
        cell: ({ row }) => <span className="font-mono text-sm">{row.original.name}</span>
      },
      {
        accessorKey: "description",
        header: t("description"),
        enableSorting: false,
        cell: ({ row }) => row.original.description || null
      }
    ],
    [t]
  );
}
