"use client";

import { useMemo } from "react";
import { Pencil, RotateCcw, Trash2 } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { useTranslations } from "next-intl";

import StatusMetaBadge from "@/components/status/StatusMetaBadge";
import { columnMeta, createKebabColumn } from "@/components/data-table";
import { StatusPill } from "@/components/kit/StatusPill";
import type { BalancerCustomStatus } from "@/types/balancer-admin.types";
import type { StatusScope } from "@/types/registration.types";

import { badgeMeta } from "./model";

export function useStatusColumns({
  canManageStatuses,
  onEdit,
  onConfirm
}: Readonly<{
  canManageStatuses: boolean;
  /** Stable identity required: the kebab column closes over both. */
  onEdit: (status: BalancerCustomStatus) => void;
  /** Reset for a built-in, delete for a custom status — the confirm dialog picks the intent. */
  onConfirm: (status: BalancerCustomStatus) => void;
}>): ColumnDef<BalancerCustomStatus>[] {
  const t = useTranslations("adminSettings.statuses");
  const scopeLabels: Record<StatusScope, string> = useMemo(
    () => ({ registration: t("scope.registration"), balancer: t("scope.balancer") }),
    [t]
  );

  return useMemo<ColumnDef<BalancerCustomStatus>[]>(
    () => [
      {
        id: "status",
        accessorFn: (row) => row.name,
        header: t("columns.status"),
        meta: columnMeta<BalancerCustomStatus>({
          category: "core",
          mandatory: true,
          searchValue: (row) => `${row.name} ${row.slug}`
        }),
        cell: ({ row }) => (
          <StatusMetaBadge meta={badgeMeta(row.original)} fallbackValue={row.original.slug} />
        )
      },
      {
        id: "scope",
        accessorFn: (row) => scopeLabels[row.scope],
        header: t("columns.scope"),
        meta: columnMeta<BalancerCustomStatus>({
          category: "core",
          searchValue: (row) => scopeLabels[row.scope]
        }),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{scopeLabels[row.original.scope]}</span>
        )
      },
      {
        id: "slug",
        accessorFn: (row) => row.slug,
        header: t("columns.slug"),
        meta: columnMeta<BalancerCustomStatus>({
          category: "meta",
          searchValue: (row) => row.slug
        }),
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.slug}</span>
      },
      {
        id: "description",
        accessorFn: (row) => row.description ?? "",
        header: t("columns.description"),
        enableSorting: false,
        meta: columnMeta<BalancerCustomStatus>({ category: "core" }),
        cell: ({ row }) => (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>{row.original.description ?? "—"}</span>
            {row.original.excludes_from_balancer ? (
              <StatusPill tone="warning">{t("badges.excludesPool")}</StatusPill>
            ) : null}
            {row.original.excludes_from_ready ? (
              <StatusPill tone="warning">{t("badges.blocksReady")}</StatusPill>
            ) : null}
          </div>
        )
      },
      createKebabColumn<BalancerCustomStatus>(
        (row) => [
          {
            label: t("actions.edit"),
            icon: Pencil,
            hidden: !canManageStatuses,
            onSelect: () => onEdit(row)
          },
          {
            label: t("actions.resetDefault"),
            icon: RotateCcw,
            hidden: !canManageStatuses || row.kind !== "builtin" || !row.can_reset,
            onSelect: () => onConfirm(row)
          },
          {
            label: t("actions.delete"),
            icon: Trash2,
            destructive: true,
            hidden: !canManageStatuses || row.kind === "builtin",
            onSelect: () => onConfirm(row)
          }
        ],
        {
          rowLabel: (row) =>
            t("rowLabel", {
              name: row.name,
              kind: row.kind === "builtin" ? t("systemKind") : t("customKind")
            })
        }
      )
    ],
    [canManageStatuses, onConfirm, onEdit, scopeLabels, t]
  );
}
