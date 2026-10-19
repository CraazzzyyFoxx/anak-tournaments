"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Pencil } from "lucide-react";

import TeamName from "@/components/TeamName";
import { columnMeta, createKebabColumn } from "@/components/data-table";
import type { Team } from "@/types/team.types";

export function useTeamColumns(): ColumnDef<Team>[] {
  const t = useTranslations("adminTournament.teams");
  return useMemo<ColumnDef<Team>[]>(
    () => [
      {
        accessorKey: "name",
        header: t("team"),
        cell: ({ row }) => <TeamName team={row.original} size="xs" nameClassName="font-medium" />,
        // Player names too: an admin often knows who is on a roster, not what it is called.
        meta: columnMeta<Team>({
          searchValue: (team) => [team.name, ...team.players.map((player) => player.name)].join(" ")
        })
      },
      {
        accessorKey: "avg_sr",
        header: t("avgSr"),
        cell: ({ row }) => row.original.avg_sr.toFixed(0),
        meta: columnMeta<Team>({ align: "right", numeric: true })
      },
      {
        accessorKey: "total_sr",
        header: t("totalSr"),
        meta: columnMeta<Team>({ align: "right", numeric: true })
      },
      {
        id: "players",
        accessorFn: (team) => team.players.length,
        header: t("players"),
        meta: columnMeta<Team>({ align: "right", numeric: true })
      },
      createKebabColumn<Team>(
        (team) => [{ label: t("open"), icon: Pencil, href: `/admin/teams/${team.id}` }],
        { rowLabel: (team) => team.name }
      )
    ],
    [t]
  );
}
