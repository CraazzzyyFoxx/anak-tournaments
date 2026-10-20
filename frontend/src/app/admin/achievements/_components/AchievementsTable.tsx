"use client";

import { ColumnDef } from "@tanstack/react-table";
import { useTranslations } from "next-intl";
import { CircleOff } from "lucide-react";

import { DataTable, columnMeta, createKebabColumn } from "@/components/data-table";
import { StatusIcon } from "@/components/admin/StatusIcon";
import adminService from "@/services/admin.service";
import { achievementQueryKeys } from "@/lib/achievements/query-keys";
import { ALL_DISCIPLINES } from "@/lib/site/discipline-scope";
import { gameColumn } from "@/components/workspace/game-column";
import type { AchievementRule } from "@/types/admin.types";

import { countLeafConditions } from "../achievement-form.model";

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

/**
 * The paged rule catalog: one game's, or every game's (`discipline: null`) with a "Game" column when `showGame`
 * (spec §6.1, §6.10). Every row action is decided by the page, not here.
 */
export function AchievementsTable({
  workspaceId,
  discipline,
  showGame,
  actions,
}: Readonly<{
  workspaceId: number;
  discipline: string | null;
  showGame: boolean;
  actions: AchievementsTableActions;
}>) {
  const t = useTranslations("adminAchievements");
  const tGame = useTranslations("common.discipline");
  const listKey = achievementQueryKeys.adminList(workspaceId, discipline ?? ALL_DISCIPLINES);

  const base: ColumnDef<AchievementRule>[] = [
    {
      accessorKey: "enabled",
      header: t("common.enabled"),
      size: 80,
      meta: columnMeta<AchievementRule>({ align: "center" }),
      // Enabled is the norm: only the exception is marked.
      cell: ({ row }) =>
        row.original.enabled ? null : <StatusIcon icon={CircleOff} label={t("common.disabled")} variant="muted" />,
    },
    { accessorKey: "slug", header: t("common.slug"), size: 180 },
    { accessorKey: "name", header: t("common.name") },
    {
      accessorKey: "category",
      header: t("common.category"),
      size: 120,
      cell: ({ row }) => t(`common.categoryValues.${row.original.category}`),
    },
    {
      accessorKey: "scope",
      header: t("common.scope"),
      size: 120,
      meta: columnMeta<AchievementRule>({ category: "meta" }),
      cell: ({ row }) => t(`common.scopeValues.${row.original.scope}`),
    },
    {
      accessorKey: "grain",
      header: t("common.grain"),
      size: 140,
      meta: columnMeta<AchievementRule>({ category: "meta" }),
      cell: ({ row }) => t(`common.grainValues.${row.original.grain}`),
    },
    {
      accessorKey: "rule_version",
      header: t("common.version"),
      size: 50,
      meta: columnMeta<AchievementRule>({ category: "meta", defaultHidden: true }),
      cell: ({ row }) => <span className="tabular-nums">{row.original.rule_version}</span>,
    },
    {
      id: "conditions_count",
      header: t("common.conditions"),
      size: 90,
      enableSorting: false,
      meta: columnMeta<AchievementRule>({ category: "meta" }),
      accessorFn: (row) => countLeafConditions(row.condition_tree),
      cell: ({ getValue }) => <span className="tabular-nums">{getValue<number>()}</span>,
    },
    createKebabColumn<AchievementRule>(
      (rule) => [
        { label: t("list.viewDetails"), onSelect: () => actions.onOpen(rule) },
        { label: t("list.edit"), onSelect: () => actions.onEdit(rule), hidden: !actions.canUpdate },
        { label: t("list.test"), onSelect: () => actions.onTest(rule) },
        { label: t("list.evaluateOne"), onSelect: () => actions.onEvaluate(rule) },
        {
          label: rule.enabled ? t("list.disable") : t("list.enable"),
          onSelect: () => actions.onToggle(rule),
          hidden: !actions.canUpdate,
        },
        {
          label: t("list.deleteAchievement"),
          onSelect: () => actions.onDelete(rule),
          destructive: true,
          hidden: !actions.canDelete,
        },
      ],
      { rowLabel: (rule) => rule.slug }
    ),
  ];

  // After enabled, slug and name: the game names the rule before its category.
  const columns = showGame
    ? [...base.slice(0, 3), gameColumn<AchievementRule>(tGame("column"), (rule) => rule.discipline), ...base.slice(3)]
    : base;

  return (
    <DataTable
      queryKey={(page, search, pageSize, sf, sd) => [...listKey, page, search, pageSize, sf, sd]}
      queryFn={async (page, search, pageSize, sortField, sortDir) =>
        adminService.getAchievementRules(workspaceId, discipline, {
          page,
          per_page: pageSize,
          search: search || undefined,
          sort: sortField ?? undefined,
          order: sortDir,
        })
      }
      columns={columns}
      columnsStorageKey="admin-achievements"
      searchPlaceholder={t("list.search")}
      emptyMessage={t("list.empty")}
      onRowClick={(row) => actions.onOpen(row.original)}
    />
  );
}
