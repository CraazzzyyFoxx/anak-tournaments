"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { CheckCircle, Eye, EyeOff, Pencil, Trash2, XCircle } from "lucide-react";

import { columnMeta, createKebabColumn } from "@/components/data-table";
import { StatusIcon } from "@/components/admin/StatusIcon";
import { WorkspaceVerificationIcon } from "@/components/admin/workspace-verification";
import type { Workspace } from "@/types/workspace.types";

import { WorkspaceIcon } from "./WorkspaceCells";

/** The workspace row: who it is, where it lives, and whether it is live and listed. */
export function useWorkspaceColumns({
  isSuperuser,
  isWorkspaceAdmin,
  onDelete
}: Readonly<{
  isSuperuser: boolean;
  isWorkspaceAdmin: (workspaceId: number) => boolean;
  /** Stable identity required: the kebab column closes over it. */
  onDelete: (workspace: Workspace) => void;
}>): ColumnDef<Workspace>[] {
  const t = useTranslations("adminAccess.common");
  return useMemo<ColumnDef<Workspace>[]>(
    () => [
      {
        accessorKey: "id",
        header: "#",
        size: 76,
        cell: ({ row }) => (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {row.original.id}
          </span>
        )
      },
      {
        accessorKey: "name",
        header: t("workspace"),
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-2">
            <WorkspaceIcon workspace={row.original} />
            <span className="truncate font-medium" title={row.original.name}>
              {row.original.name}
            </span>
            <WorkspaceVerificationIcon status={row.original.verification_status} />
          </div>
        )
      },
      {
        accessorKey: "slug",
        header: t("slug"),
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">{row.original.slug}</span>
        )
      },
      {
        accessorKey: "is_active",
        header: t("status"),
        size: 120,
        meta: columnMeta<Workspace>({ align: "center" }),
        cell: ({ row }) =>
          row.original.is_active ? (
            <StatusIcon icon={CheckCircle} label={t("active")} variant="success" />
          ) : (
            <StatusIcon icon={XCircle} label={t("inactive")} variant="muted" />
          )
      },
      {
        accessorKey: "is_hidden",
        header: t("visibility"),
        size: 120,
        meta: columnMeta<Workspace>({ align: "center" }),
        cell: ({ row }) =>
          row.original.is_hidden ? (
            <StatusIcon icon={EyeOff} label={t("hidden")} variant="warning" />
          ) : (
            <StatusIcon icon={Eye} label={t("listed")} variant="muted" />
          )
      },
      createKebabColumn<Workspace>(
        (row) => [
          {
            label: t("editWorkspace"),
            icon: Pencil,
            hidden: !(isSuperuser || isWorkspaceAdmin(row.id)),
            // The one place a workspace is edited: the settings sections under
            // `[id]/`, which are the same ones `/admin/settings` mounts.
            href: `/admin/workspaces/${row.id}/general`
          },
          {
            label: t("deleteWorkspace"),
            icon: Trash2,
            destructive: true,
            hidden: !isSuperuser,
            onSelect: () => onDelete(row)
          }
        ],
        { rowLabel: (row) => row.name }
      )
    ],
    [isSuperuser, isWorkspaceAdmin, onDelete, t]
  );
}
