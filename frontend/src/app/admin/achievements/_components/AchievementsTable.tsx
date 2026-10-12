"use client";

import { ColumnDef } from "@tanstack/react-table";
import { useTranslations } from "next-intl";
import {
  CheckCircle,
  CircleOff,
  Eye,
  EyeOff,
  MoreHorizontal,
  Pencil,
  Play,
  TestTube,
  Trash2,
} from "lucide-react";

import { DataTable, columnMeta } from "@/components/data-table";
import { StatusIcon } from "@/components/admin/StatusIcon";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import adminService from "@/services/admin.service";
import { achievementQueryKeys } from "@/lib/achievements/query-keys";
import type { AchievementRule } from "@/types/admin.types";

import { countLeafConditions } from "../achievement-form.model";
import { IconLabel, categoryIcon, grainIcon, scopeIcon } from "../achievement-meta";

export interface AchievementsTableActions {
  canUpdate: boolean;
  canDelete: boolean;
  onOpen: (rule: AchievementRule) => void;
  onEdit: (rule: AchievementRule) => void;
  onTest: (rule: AchievementRule) => void;
  onEvaluate: (rule: AchievementRule) => void;
  onToggle: (rule: AchievementRule) => void;
  onDelete: (rule: AchievementRule) => void;
}

/** The paged rule catalog. Every row action is decided by the page, not here. */
export function AchievementsTable({
  workspaceId,
  actions,
}: Readonly<{ workspaceId: number; actions: AchievementsTableActions }>) {
  const t = useTranslations("adminAchievements");
  const listKey = achievementQueryKeys.adminList(workspaceId);

  const columns: ColumnDef<AchievementRule>[] = [
    {
      accessorKey: "id",
      header: t("common.id"),
      size: 60,
      cell: ({ row }) => <span className="tabular-nums">{row.original.id}</span>,
    },
    {
      accessorKey: "enabled",
      header: t("common.action"),
      size: 80,
      meta: columnMeta<AchievementRule>({ align: "center" }),
      cell: ({ row }) =>
        row.original.enabled ? (
          <StatusIcon icon={CheckCircle} label={t("common.on")} variant="success" />
        ) : (
          <StatusIcon icon={CircleOff} label={t("common.off")} variant="muted" />
        ),
    },
    { accessorKey: "slug", header: t("common.slug"), size: 180 },
    { accessorKey: "name", header: t("common.name") },
    {
      accessorKey: "category",
      header: t("common.category"),
      size: 120,
      cell: ({ row }) => (
        <IconLabel icon={categoryIcon(row.original.category)} label={t(`common.categoryValues.${row.original.category}`)} />
      ),
    },
    {
      accessorKey: "scope",
      header: t("common.scope"),
      size: 120,
      cell: ({ row }) => (
        <IconLabel icon={scopeIcon(row.original.scope)} label={t(`common.scopeValues.${row.original.scope}`)} />
      ),
    },
    {
      accessorKey: "grain",
      header: t("common.grain"),
      size: 140,
      cell: ({ row }) => (
        <IconLabel icon={grainIcon(row.original.grain)} label={t(`common.grainValues.${row.original.grain}`)} />
      ),
    },
    {
      accessorKey: "rule_version",
      header: t("common.version"),
      size: 50,
      cell: ({ row }) => <span className="tabular-nums">{row.original.rule_version}</span>,
    },
    {
      id: "conditions_count",
      header: t("condition.addCondition"),
      size: 90,
      enableSorting: false,
      accessorFn: (row) => countLeafConditions(row.condition_tree),
      cell: ({ getValue }) => <span className="tabular-nums">{getValue<number>()}</span>,
    },
    {
      id: "actions",
      size: 50,
      cell: ({ row }) => {
        const rule = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button aria-label={t("listActionsFor", { slug: rule.slug })} variant="ghost" size="icon">
                <MoreHorizontal className="h-4 w-4" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{t("list.actions")}</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => actions.onOpen(rule)}>
                <Eye className="mr-2 h-4 w-4" aria-hidden />
                {t("list.viewDetails")}
              </DropdownMenuItem>
              {actions.canUpdate && (
                <DropdownMenuItem onClick={() => actions.onEdit(rule)}>
                  <Pencil className="mr-2 h-4 w-4" aria-hidden />
                  {t("list.edit")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => actions.onTest(rule)}>
                <TestTube className="mr-2 h-4 w-4" aria-hidden />
                {t("list.test")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => actions.onEvaluate(rule)}>
                <Play className="mr-2 h-4 w-4" aria-hidden />
                {t("list.evaluateOne")}
              </DropdownMenuItem>
              {actions.canUpdate && (
                <DropdownMenuItem onClick={() => actions.onToggle(rule)}>
                  {rule.enabled ? (
                    <><EyeOff className="mr-2 h-4 w-4" aria-hidden />{t("list.disable")}</>
                  ) : (
                    <><Eye className="mr-2 h-4 w-4" aria-hidden />{t("list.enable")}</>
                  )}
                </DropdownMenuItem>
              )}
              {actions.canUpdate && actions.canDelete && <DropdownMenuSeparator />}
              {actions.canDelete && (
                <DropdownMenuItem onClick={() => actions.onDelete(rule)} className="text-destructive">
                  <Trash2 className="mr-2 h-4 w-4" aria-hidden />
                  {t("list.deleteAchievement")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return (
    <DataTable
      queryKey={(page, search, pageSize, sf, sd) => [...listKey, page, search, pageSize, sf, sd]}
      queryFn={async (page, search, pageSize, sortField, sortDir) =>
        adminService.getAchievementRules(workspaceId, {
          page,
          per_page: pageSize,
          search: search || undefined,
          sort: sortField ?? undefined,
          order: sortDir,
        })
      }
      columns={columns}
      searchPlaceholder={t("list.search")}
      emptyMessage={t("list.empty")}
      onRowClick={(row) => actions.onOpen(row.original)}
    />
  );
}
