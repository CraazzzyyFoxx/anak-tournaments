"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";

import { createKebabColumn } from "@/components/data-table";
import { StatusPill } from "@/components/kit/StatusPill";
import { GameLabel } from "@/components/workspace/GameLabel";
import { TOURNAMENT_STATUS_TONE } from "@/app/admin/tournaments/[id]/components/tournamentWorkspace.helpers";
import { formatDateRange } from "@/lib/datetime";
import { useFormatter } from "@/lib/datetime/client";
import { formatTournamentStages } from "@/lib/tournament/stages";
import type { DisciplineDescriptor } from "@/types/discipline.types";
import type { Tournament } from "@/types/tournament.types";

/** The tournament row: what it is, whether it wants attention, when, and how it is staged. */
export function useTournamentColumns({
  canCreate,
  canDelete,
  onDelete,
  games
}: Readonly<{
  /** `tournament.create`: the wizard a stage-less draft resumes in. */
  canCreate: boolean;
  canDelete: boolean;
  /** Stable identity required: the kebab closes over it. */
  onDelete: (tournament: Tournament) => void;
  /** Installed games by code, passed only under "all games" of a multi-game area: adds the "Игра" column (§6.1). */
  games?: Map<string, DisciplineDescriptor>;
}>): ColumnDef<Tournament>[] {
  const t = useTranslations("adminTournaments.list");
  const tStatus = useTranslations("common.statusBadge");
  const tDiscipline = useTranslations("common.discipline");
  const format = useFormatter();
  return useMemo<ColumnDef<Tournament>[]>(
    () => [
      {
        accessorKey: "name",
        header: t("columns.name"),
        cell: ({ row }) => (
          <span className="font-medium">
            {row.original.name}
            {row.original.is_league ? (
              <span className="ml-2 text-caption font-normal text-muted-foreground">
                {t("type.league")}
              </span>
            ) : null}
          </span>
        )
      },
      ...(games
        ? [
            {
              id: "discipline",
              accessorKey: "discipline",
              header: tDiscipline("column"),
              enableSorting: false,
              cell: ({ row }) => <GameLabel code={row.original.discipline} games={games} />
            } satisfies ColumnDef<Tournament>
          ]
        : []),
      {
        accessorKey: "status",
        header: t("columns.status"),
        enableSorting: false,
        // Unpublished first: a hidden tournament is a draft whatever its phase.
        // A finished one renders nothing, the absence says it.
        cell: ({ row }) => {
          const tournament = row.original;
          if (tournament.is_hidden) {
            return <StatusPill tone="neutral">{t("status.unpublished")}</StatusPill>;
          }
          if (
            tournament.is_finished ||
            tournament.status === "completed" ||
            tournament.status === "archived"
          ) {
            return null;
          }
          return (
            <StatusPill tone={TOURNAMENT_STATUS_TONE[tournament.status]}>
              {tStatus(tournament.status)}
            </StatusPill>
          );
        }
      },
      {
        accessorKey: "start_date",
        header: t("columns.dates"),
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatDateRange(format, row.original.start_date, row.original.end_date)}
          </span>
        )
      },
      {
        accessorKey: "stages",
        header: t("columns.stages"),
        enableSorting: false,
        cell: ({ row }) => {
          const stages = row.original.stages ?? [];
          if (stages.length === 0) return null;
          const stagesLabel = formatTournamentStages(stages);
          return (
            <div className="max-w-80 truncate text-muted-foreground" title={stagesLabel}>
              {stagesLabel}
            </div>
          );
        }
      },
      createKebabColumn<Tournament>(
        (tournament) => [
          { label: t("openHub"), href: `/admin/tournaments/${tournament.id}` },
          {
            label: t("resumeWizard"),
            href: `/admin/tournaments/new?resume=${tournament.id}`,
            hidden: !canCreate || !tournament.is_hidden || (tournament.stages ?? []).length > 0
          },
          {
            label: t("delete"),
            onSelect: () => onDelete(tournament),
            destructive: true,
            hidden: !canDelete
          }
        ],
        { rowLabel: (tournament) => tournament.name }
      )
    ],
    [canCreate, canDelete, format, games, onDelete, t, tDiscipline, tStatus]
  );
}
