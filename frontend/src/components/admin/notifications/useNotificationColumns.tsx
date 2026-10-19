"use client";

import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { useTranslations } from "next-intl";

import { columnMeta } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useFormatter } from "@/lib/datetime/client";
import type { NotificationAdminItem } from "@/types/notification.types";

import { isRetired } from "./model";

/**
 * The produced-notification columns. The retire column exists only for a
 * `notification.delete` holder; `onRetire` asks for the confirmation, it does
 * not retire.
 */
export function useNotificationColumns({
  canRetire,
  retirePending,
  onRetire
}: Readonly<{
  canRetire: boolean;
  retirePending: boolean;
  onRetire: (target: { ids: number[] }) => void;
}>): ColumnDef<NotificationAdminItem>[] {
  const t = useTranslations<never>();
  const format = useFormatter();

  return useMemo<ColumnDef<NotificationAdminItem>[]>(() => {
    const defs: ColumnDef<NotificationAdminItem>[] = [
      {
        accessorKey: "kind",
        header: t("notifications.workspaceAdmin.columns.kind"),
        size: 220,
        // One server order (newest first); a header sort would change nothing.
        enableSorting: false,
        meta: columnMeta<NotificationAdminItem>({ align: "center" }),
        cell: ({ row }) => (
          <Badge tone="neutral" className="font-normal">
            {t(`notifications.workspaceAdmin.kinds.${row.original.kind}` as never)}
          </Badge>
        )
      },
      {
        id: "recipient",
        header: t("notifications.workspaceAdmin.columns.recipient"),
        size: 200,
        enableSorting: false,
        // Username joined at read time, id as the fallback: the account can be
        // gone while the row it was told about still has to be retirable.
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.recipient_username ?? row.original.recipient_auth_user_id ?? "—"}
          </span>
        )
      },
      {
        accessorKey: "published_at",
        header: t("notifications.workspaceAdmin.columns.publishedAt"),
        size: 190,
        enableSorting: false,
        cell: ({ row }) =>
          row.original.published_at == null ? (
            <span className="text-sm text-muted-foreground">&mdash;</span>
          ) : (
            <time dateTime={row.original.published_at} className="whitespace-nowrap text-sm tabular-nums">
              {format.dateTime(new Date(row.original.published_at), {
                dateStyle: "medium",
                timeStyle: "short"
              })}
            </time>
          )
      },
      {
        id: "state",
        header: t("notifications.workspaceAdmin.columns.state"),
        size: 130,
        enableSorting: false,
        meta: columnMeta<NotificationAdminItem>({ align: "center" }),
        cell: ({ row }) => (
          <Badge tone={isRetired(row.original) ? "neutral" : "success"} className="font-normal">
            {t(
              isRetired(row.original)
                ? "notifications.workspaceAdmin.state.retired"
                : "notifications.workspaceAdmin.state.live"
            )}
          </Badge>
        )
      }
    ];

    if (canRetire) {
      defs.push({
        id: "actions",
        header: "",
        size: 130,
        enableSorting: false,
        cell: ({ row }) =>
          isRetired(row.original) ? null : (
            <Button
              variant="ghost"
              size="sm"
              disabled={retirePending}
              onClick={() => onRetire({ ids: [row.original.id] })}
            >
              {t("notifications.workspaceAdmin.retire.action")}
            </Button>
          )
      });
    }
    return defs;
  }, [t, format, canRetire, retirePending, onRetire]);
}
