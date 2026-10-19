"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { useQuery } from "@tanstack/react-query";

import { DataTable, columnMeta } from "@/components/data-table";
import { PageStateCard } from "@/components/ui/page-state-card";
import userService from "@/services/user.service";
import type { AchievementRarity } from "@/types/achievement.types";
import { adminQueryKeys } from "@/lib/admin/query-keys";

/**
 * What this person has earned.
 *
 * Read-only: an achievement's rules, evaluation and overrides all belong to
 * the achievement, not to a holder, so every write lives on the achievement's
 * own page and this tab links there.
 */
export function PersonAchievementsTab({ personId }: Readonly<{ personId: number }>) {
  const t = useTranslations("adminPeople.achievements");
  const tCategory = useTranslations("adminAchievements.common.categoryValues");
  const achievementsQuery = useQuery({
    queryKey: adminQueryKeys.personAchievements(personId),
    queryFn: () => userService.getUserAchievements(personId)
  });

  const columns = useMemo<ColumnDef<AchievementRarity>[]>(
    () => [
      {
        accessorKey: "name",
        header: t("achievement"),
        meta: columnMeta<AchievementRarity>({
          sticky: true,
          searchValue: (row) => `${row.name} ${row.slug}`
        }),
        cell: ({ row }) => (
          <Link
            className="font-medium underline-offset-4 hover:underline"
            href={`/admin/achievements/${row.original.id}`}
          >
            {row.original.name}
          </Link>
        )
      },
      {
        accessorKey: "category",
        header: t("category"),
        cell: ({ row }) => {
          const category = row.original.category as "overall" | null;
          if (!category) return null;
          return (
            <span className="text-sm text-muted-foreground">
              {tCategory.has(category) ? tCategory(category) : category}
            </span>
          );
        }
      },
      {
        accessorKey: "count",
        header: t("times"),
        size: 90,
        meta: columnMeta<AchievementRarity>({ numeric: true, align: "right" }),
        cell: ({ row }) => <span className="tabular-nums">{row.original.count}</span>
      },
      {
        id: "tournaments",
        header: t("tournaments"),
        enableSorting: false,
        cell: ({ row }) => (
          <span className="truncate text-sm text-muted-foreground">
            {row.original.tournaments.map((tournament) => tournament.name).join(", ")}
          </span>
        )
      }
    ],
    [t, tCategory]
  );

  if (achievementsQuery.isError) {
    return (
      <PageStateCard
        state="error"
        title={t("loadError")}
        onAction={() => void achievementsQuery.refetch()}
        actionLabel={t("retry")}
      />
    );
  }

  return (
    <DataTable<AchievementRarity>
      rows={achievementsQuery.data ?? []}
      isLoading={achievementsQuery.isLoading}
      columns={columns}
      initialPageSize={20}
      getRowId={(row) => String(row.id)}
      searchPlaceholder={t("search")}
      emptyMessage={t("empty")}
    />
  );
}
