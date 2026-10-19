"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { CheckCircle, CircleDot, Crown, EyeOff, Trash2, Trophy } from "lucide-react";

import { columnMeta } from "@/components/data-table";
import { StatusIcon } from "@/components/admin/StatusIcon";
import { Button } from "@/components/ui/button";
import { useFormatter } from "@/lib/datetime/client";
import { formatTournamentStages } from "@/lib/tournament/stages";
import type { Tournament } from "@/types/tournament.types";

/** The tournament row: what it is, whether it is running, when, and how it is staged. */
export function useTournamentColumns({
  canDelete,
  onDelete
}: Readonly<{
  canDelete: boolean;
  /** Stable identity required: the delete button closes over it. */
  onDelete: (tournament: Tournament) => void;
}>): ColumnDef<Tournament>[] {
  const t = useTranslations("adminTournaments.list");
  const format = useFormatter();
  return useMemo<ColumnDef<Tournament>[]>(
    () => [
      {
        accessorKey: "name",
        header: t("columns.name"),
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span className="font-medium">{row.original.name}</span>
            {row.original.is_hidden ? (
              <StatusIcon icon={EyeOff} label={t("status.unpublished")} variant="muted" />
            ) : null}
          </div>
        )
      },
      {
        accessorKey: "is_league",
        header: t("columns.type"),
        meta: columnMeta<Tournament>({ align: "center" }),
        cell: ({ row }) =>
          row.getValue("is_league") ? (
            <StatusIcon icon={Crown} label={t("type.league")} variant="info" />
          ) : (
            <StatusIcon icon={Trophy} label={t("type.tournament")} variant="muted" />
          )
      },
      {
        accessorKey: "is_finished",
        header: t("columns.status"),
        meta: columnMeta<Tournament>({ align: "center" }),
        cell: ({ row }) =>
          row.getValue("is_finished") ? (
            <StatusIcon icon={CheckCircle} label={t("status.finished")} variant="muted" />
          ) : (
            <StatusIcon icon={CircleDot} label={t("status.active")} variant="success" />
          )
      },
      {
        accessorKey: "start_date",
        header: t("columns.startDate"),
        cell: ({ row }) => (
          <span className="tabular-nums">
            {/* Tournament days are UTC midnights — read in UTC. */}
            {format.dateTime(new Date(row.getValue("start_date")), { dateStyle: "medium", timeZone: "UTC" })}
          </span>
        )
      },
      {
        accessorKey: "end_date",
        header: t("columns.endDate"),
        cell: ({ row }) => (
          <span className="tabular-nums">
            {format.dateTime(new Date(row.getValue("end_date")), { dateStyle: "medium", timeZone: "UTC" })}
          </span>
        )
      },
      {
        accessorKey: "stages",
        header: t("columns.stages"),
        enableSorting: false,
        cell: ({ row }) => {
          const stages = row.original.stages ?? [];
          if (stages.length === 0) {
            return <span className="text-muted-foreground">{t("noStages")}</span>;
          }

          const stagesLabel = formatTournamentStages(stages);

          return (
            <div className="max-w-80">
              <div className="font-medium tabular-nums">
                {t("stageCount", { count: stages.length })}
              </div>
              <div className="truncate text-xs text-muted-foreground" title={stagesLabel}>
                {stagesLabel}
              </div>
            </div>
          );
        }
      },
      {
        id: "actions",
        cell: ({ row }) =>
          canDelete ? (
            <div className="flex items-center gap-2">
              <Button
                aria-label={t("deleteAria", { name: row.original.name })}
                variant="ghost"
                size="icon"
                onClick={() => onDelete(row.original)}
                className="text-destructive"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          ) : null
      }
    ],
    [canDelete, format, onDelete, t]
  );
}
