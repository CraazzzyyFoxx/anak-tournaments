"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { FileCheck2, FileX2, ListChecks, Pencil, Trash2 } from "lucide-react";

import { columnMeta, createKebabColumn } from "@/components/data-table";
import { StatusIcon } from "@/components/admin/StatusIcon";
import { StatusPill } from "@/components/kit/StatusPill";
import TeamName from "@/components/TeamName";
import { pregameRoomHref } from "@/lib/encounter/pregame-room";
import { duelSeats, isLobby, seatsBySlot, seatTeam } from "@/lib/encounter/seats";
import type { Encounter } from "@/types/encounter.types";

import { EncounterStatusCell, ScheduledAtCell, encounterScopeLabel } from "./EncounterCells";

/** The encounter row: who plays, under what, when, and what came of it. */
export function useEncounterColumns({
  canUpdate,
  canDelete,
  returnTo,
  onEdit,
  onDelete
}: Readonly<{
  canUpdate: boolean;
  canDelete: boolean;
  /** Where the pre-game room hands the organizer back — this list, as filtered. */
  returnTo: string;
  /** Stable identity required: the kebab column closes over both. */
  onEdit: (encounter: Encounter) => void;
  onDelete: (encounter: Encounter) => void;
}>): ColumnDef<Encounter>[] {
  const t = useTranslations("adminMatches.encounters");
  const commonT = useTranslations("adminMatches.common");
  return useMemo<ColumnDef<Encounter>[]>(
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
        header: t("encounter"),
        cell: ({ row }) => (
          <div className="min-w-0 max-w-[18rem]">
            <p className="truncate font-medium text-foreground" title={row.original.name}>
              {row.original.name}
            </p>
            <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
              {isLobby(row.original) ? (
                <span>{t("teamsCount", { count: row.original.teams.length, total: row.original.slot_count })}</span>
              ) : (
                <>
                  <TeamName team={seatTeam(duelSeats(row.original.teams)[0])} fallback={commonT("tbd")} size="xs" />
                  <span>{t("vs")}</span>
                  <TeamName team={seatTeam(duelSeats(row.original.teams)[1])} fallback={commonT("tbd")} size="xs" />
                </>
              )}
            </p>
          </div>
        )
      },
      {
        id: "stage",
        header: t("stageRound"),
        enableSorting: false,
        cell: ({ row }) => (
          <div className="text-sm">
            {encounterScopeLabel(row.original)}
            <span className="text-muted-foreground"> · R</span>
            <span className="tabular-nums text-muted-foreground">{row.original.round}</span>
          </div>
        )
      },
      {
        accessorKey: "scheduled_at",
        header: t("scheduled"),
        size: 132,
        cell: ({ row }) => <ScheduledAtCell value={row.original.scheduled_at} />
      },
      {
        id: "score",
        header: t("score"),
        size: 92,
        enableSorting: false,
        cell: ({ row }) => (
          <span className="font-mono text-sm font-semibold tabular-nums">
            {seatsBySlot(row.original.teams).map((seat) => seat.score).join(" \u2013 ")}
          </span>
        )
      },
      {
        accessorKey: "status",
        header: t("status"),
        size: 132,
        meta: columnMeta<Encounter>({ align: "center" }),
        cell: ({ row }) => <EncounterStatusCell status={row.original.status} />
      },
      {
        id: "result",
        header: t("result"),
        size: 132,
        enableSorting: false,
        cell: ({ row }) => (
          <StatusPill tone={row.original.result_status === "disputed" ? "danger" : "neutral"}>
            {t(`resultStatus.${row.original.result_status}`)}
          </StatusPill>
        )
      },
      {
        accessorKey: "has_logs",
        header: t("logs"),
        size: 108,
        meta: columnMeta<Encounter>({ align: "center" }),
        cell: ({ row }) =>
          row.original.has_logs ? (
            <StatusIcon icon={FileCheck2} label={t("available")} variant="success" />
          ) : (
            <StatusIcon icon={FileX2} label={t("missing")} variant="muted" />
          )
      },
      createKebabColumn<Encounter>(
        (row) => [
          {
            label: t("openRoom"),
            icon: ListChecks,
            // An FFA lobby has no captain room to open.
            hidden: isLobby(row),
            href: pregameRoomHref(row.tournament_id, row.id, returnTo)
          },
          { label: t("edit"), icon: Pencil, hidden: !canUpdate, onSelect: () => onEdit(row) },
          {
            label: t("delete"),
            icon: Trash2,
            destructive: true,
            hidden: !canDelete,
            onSelect: () => onDelete(row)
          }
        ],
        { rowLabel: (row) => row.name }
      )
    ],
    // `onEdit` was missing here once: the kebab's "Edit encounter" called
    // whichever closure the first render happened to build.
    [canUpdate, canDelete, returnTo, onEdit, onDelete, t, commonT]
  );
}
