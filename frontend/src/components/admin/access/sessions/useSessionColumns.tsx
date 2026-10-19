"use client";

import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { MonitorSmartphone, UserCog } from "lucide-react";
import { useTranslations } from "next-intl";

import { columnMeta, createKebabColumn } from "@/components/data-table";
import { useFormatter } from "@/lib/datetime/client";
import type { AdminAuthSession } from "@/types/rbac.types";

import { accountsHref, formatDeviceLabel, formatTimestamp } from "./model";
import { SessionStatusCell } from "./SessionCells";

export function useSessionColumns() {
  const t = useTranslations("adminAccess.common");
  const format = useFormatter();

  return useMemo<ColumnDef<AdminAuthSession>[]>(
    () => [
      {
        accessorKey: "session_id",
        header: "ID",
        size: 140,
        enableSorting: false,
        cell: ({ row }) => (
          <span className="block truncate font-mono text-xs" title={row.original.session_id}>
            {row.original.session_id}
          </span>
        )
      },
      {
        id: "user",
        header: t("account"),
        enableSorting: false,
        accessorFn: (row) => row.email ?? row.username ?? `#${row.user_id}`,
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {row.original.email ?? t("emailUnavailable")}
            </p>
            <p className="truncate font-mono text-xs text-muted-foreground">
              {row.original.username
                ? `@${row.original.username}`
                : `account #${row.original.user_id}`}
            </p>
          </div>
        )
      },
      {
        id: "device",
        header: t("device"),
        enableSorting: false,
        accessorFn: (row) => formatDeviceLabel(row.user_agent, t("unknownDevice")),
        cell: ({ row }) => (
          <span className="flex min-w-0 items-center gap-2">
            <MonitorSmartphone aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate text-sm">
              {formatDeviceLabel(row.original.user_agent, t("unknownDevice"))}
            </span>
          </span>
        )
      },
      {
        accessorKey: "status",
        header: t("status"),
        meta: columnMeta<AdminAuthSession>({ align: "center" }),
        cell: ({ row }) => <SessionStatusCell status={row.original.status} />
      },
      {
        accessorKey: "login_at",
        header: t("signedIn"),
        cell: ({ row }) => (
          <span className="text-sm tabular-nums text-muted-foreground">
            {formatTimestamp(format, row.original.login_at, t("unavailable"))}
          </span>
        )
      },
      {
        accessorKey: "last_seen_at",
        header: t("lastSeen"),
        cell: ({ row }) => (
          <span className="text-sm tabular-nums text-muted-foreground">
            {formatTimestamp(format, row.original.last_seen_at, t("unavailable"))}
          </span>
        )
      },
      createKebabColumn<AdminAuthSession>(
        (row) => [{ label: t("openAuthAccount"), icon: UserCog, href: accountsHref(row) }],
        { rowLabel: (row) => `session of ${row.email ?? row.username ?? `#${row.user_id}`}` }
      )
    ],
    [format, t]
  );
}
