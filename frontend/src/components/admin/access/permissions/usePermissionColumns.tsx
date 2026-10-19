"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";

import { columnMeta } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import type { RbacPermission } from "@/types/rbac.types";

/** The permission row: its name, the resource and action it is built from, and what it allows. */
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
        accessorKey: "resource",
        header: t("resource"),
        meta: columnMeta<RbacPermission>({ align: "center" }),
        cell: ({ row }) => <Badge variant="outline">{row.original.resource}</Badge>
      },
      {
        accessorKey: "action",
        header: t("action"),
        meta: columnMeta<RbacPermission>({ align: "center" }),
        cell: ({ row }) => <Badge variant="secondary">{row.original.action}</Badge>
      },
      {
        accessorKey: "description",
        header: t("description"),
        enableSorting: false,
        cell: ({ row }) =>
          row.original.description || (
            <span className="text-muted-foreground">{t("noDescription")}</span>
          )
      }
    ],
    [t]
  );
}
