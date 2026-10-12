"use client";

import { useMemo, type ReactNode } from "react";
import type { ColumnDef } from "@tanstack/react-table";

import { columnMeta } from "@/components/data-table";
import { AdminReportPairCell } from "@/components/admin/AdminReportPairCell";
import { StatusPill } from "@/components/kit/StatusPill";
import { TONE_TEXT } from "@/components/kit/tone";
import type { DateFormatter } from "@/components/kit/format-time";
import { useFormatter } from "@/lib/datetime/client";
import { cn } from "@/lib/utils";
import type { AdminCaptainReport, EncounterReportsRow } from "@/types/admin.types";
import type { ReplayCode, ReportCustomFieldDefinition } from "@/types/encounter.types";

import { reportOf, scoreline } from "@/lib/encounter/reports";
import { seatsBySlot } from "@/lib/encounter/seats";

import { DASH, fmtDate, replayCodesText, submittedAt } from "./report-model";

/**
 * One field of every seat's report, in slot order.
 *
 * Every added column compares the seats, and a column that showed one of them
 * would hide exactly the disagreement an admin opened the table to find.
 */
function SeatsCell({
  rows
}: Readonly<{ rows: { slot: number; name: string; value: ReactNode }[] }>) {
  return (
    <div className="space-y-0.5 text-xs">
      {rows.map(({ slot, name, value }) => (
        <p key={slot} className="truncate">
          <span className="mr-1 text-muted-foreground" title={name}>
            {slot}
          </span>
          {value}
        </p>
      ))}
    </div>
  );
}

/**
 * A column reading one string off each seat's report (`seatIds` is the slot
 * order of the row's seats), blank rendered as an em dash.
 */
function sidesColumn(
  id: string,
  header: string,
  read: (report: AdminCaptainReport | null, seatIds: number[], codes: ReplayCode[]) => string,
  meta: Parameters<typeof columnMeta<EncounterReportsRow>>[0]
): ColumnDef<EncounterReportsRow> {
  return {
    id,
    header,
    // The endpoint sorts on none of these, so a sort control would be a lie.
    enableSorting: false,
    cell: ({ row }) => {
      const seats = seatsBySlot(row.original.participations);
      const seatIds = seats.map((seat) => seat.encounter_team_id);
      return (
        <SeatsCell
          rows={seats.map((seat) => {
            const text = read(
              reportOf(row.original.reports, seat.encounter_team_id),
              seatIds,
              row.original.replay_codes.filter((code) => code.encounter_team_id === seat.encounter_team_id)
            );
            return {
              slot: seat.slot,
              name: seat.name,
              value: <span title={text || undefined}>{text || DASH}</span>
            };
          })}
        />
      );
    },
    meta: columnMeta<EncounterReportsRow>(meta)
  };
}

/**
 * The dispute table's columns: what both captains said, side by side, plus the
 * recorded state the admin is about to change.
 *
 * Only the first handful are on by default — the rest answer the second
 * question ("who filed that, and when"), and a table that opened with twenty
 * columns answered none of them.
 */
export function useEncounterReportColumns({
  showTournament,
  customFields
}: Readonly<{
  /** The scope is wider than one tournament, so each row must name its own. */
  showTournament: boolean;
  /** Organizer-defined questions, one hidden column each. */
  customFields: ReportCustomFieldDefinition[];
}>): ColumnDef<EncounterReportsRow>[] {
  const format: DateFormatter = useFormatter();

  return useMemo<ColumnDef<EncounterReportsRow>[]>(
    () => [
      {
        id: "encounter",
        header: "Encounter",
        // The server sorts none of these, so offering a sort control would be a
        // lie the header cannot honour.
        enableSorting: false,
        cell: ({ row }) => (
          <div className="min-w-0 max-w-[18rem]">
            <p className="truncate font-medium text-foreground" title={row.original.name}>
              {row.original.name}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {showTournament ? `${row.original.tournament_name ?? "Unknown tournament"} · ` : ""}
              {row.original.stage_name ?? "Unassigned"} · Round {row.original.round} · BO
              {row.original.best_of}
            </p>
          </div>
        ),
        // The one column that names the row: hiding it would leave a table of
        // anonymous numbers, so the picker renders it checked and disabled.
        meta: columnMeta<EncounterReportsRow>({ category: "core", mandatory: true })
      },
      {
        id: "teams",
        header: "Recorded teams",
        enableSorting: false,
        cell: ({ row }) => (
          <p className="max-w-[16rem] truncate text-xs text-muted-foreground">
            {seatsBySlot(row.original.participations)
              .map((seat) => seat.name)
              .join(" vs ")}
          </p>
        ),
        meta: columnMeta<EncounterReportsRow>({ category: "core" })
      },
      {
        id: "reports",
        header: "Captain reports",
        size: 320,
        enableSorting: false,
        cell: ({ row }) => (
          <AdminReportPairCell
            participations={row.original.participations}
            reports={row.original.reports}
            standingsMatch={row.original.standings_match}
            seriesScoreValid={row.original.series_score_valid}
          />
        ),
        meta: columnMeta<EncounterReportsRow>({ category: "core" })
      },
      // Match quality decides seeding and prize splits in some formats, so it
      // is on by default rather than buried in the picker: the reason to open
      // this table at all is often "how close were these".
      sidesColumn(
        "closeness",
        "Closeness",
        (report) =>
          report == null || report.closeness == null ? "" : `${report.closeness}/10`,
        { category: "core", numeric: true, className: "min-w-[86px]" }
      ),
      {
        id: "result",
        header: "Result",
        size: 132,
        enableSorting: false,
        cell: ({ row }) => (
          <div className="space-y-1">
            <StatusPill tone={row.original.result_status === "disputed" ? "danger" : "neutral"}>
              {row.original.result_status}
            </StatusPill>
            {row.original.last_resolution ? (
              <p className="text-xs text-muted-foreground">
                {row.original.last_resolution.action} by{" "}
                {row.original.last_resolution.actor_name ?? "an automated process"}
              </p>
            ) : null}
          </div>
        ),
        meta: columnMeta<EncounterReportsRow>({ category: "core" })
      },
      {
        id: "reported_count",
        header: "Filed",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-xs tabular-nums">
            {row.original.reported_count}/{row.original.participations.length}
          </span>
        ),
        meta: columnMeta<EncounterReportsRow>({
          category: "meta",
          defaultHidden: true,
          align: "center",
          numeric: true
        })
      },
      {
        id: "scheduled_at",
        header: "Scheduled",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-xs tabular-nums">{fmtDate(format, row.original.scheduled_at)}</span>
        ),
        meta: columnMeta<EncounterReportsRow>({
          category: "meta",
          defaultHidden: true,
          responsive: "lg",
          className: "min-w-[150px]"
        })
      },
      sidesColumn("reporters", "Reported by", (report) => report?.reporter_name ?? "", {
        category: "meta",
        defaultHidden: true,
        responsive: "lg",
        className: "min-w-[140px]"
      }),
      sidesColumn("submitted", "Submitted", (report) => {
        const at = submittedAt(report);
        return at ? format.dateTime(new Date(at), { dateStyle: "medium", timeStyle: "short" }) : "";
      }, {
        category: "meta",
        defaultHidden: true,
        responsive: "lg",
        numeric: true,
        className: "min-w-[150px]"
      }),
      sidesColumn(
        "scores",
        "Reported score",
        (report, seatIds) => (report ? scoreline(report.results, seatIds) : ""),
        { category: "meta", defaultHidden: true, numeric: true, className: "min-w-[100px]" }
      ),
      sidesColumn("map_codes", "Lobby codes", (_report, _seatIds, codes) => replayCodesText(codes), {
        category: "meta",
        defaultHidden: true,
        responsive: "lg",
        className: "min-w-[180px] max-w-[240px]"
      }),
      sidesColumn("comments", "Comments", (report) => report?.comment ?? "", {
        category: "meta",
        defaultHidden: true,
        responsive: "lg",
        className: "min-w-[200px] max-w-[280px]"
      }),
      {
        id: "series_score_valid",
        header: "Series check",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.series_score_valid ? (
            <span className="text-xs text-muted-foreground">ok</span>
          ) : (
            // Advisory, not an error: reports predate per-round best-of.
            <span className={cn("text-xs", TONE_TEXT.warning)} title="A reported score is impossible for this encounter's best-of">
              outside BO
            </span>
          ),
        meta: columnMeta<EncounterReportsRow>({ category: "meta", defaultHidden: true })
      },
      {
        id: "status",
        header: "Encounter status",
        enableSorting: false,
        cell: ({ row }) => <span className="text-xs">{row.original.status}</span>,
        meta: columnMeta<EncounterReportsRow>({ category: "meta", defaultHidden: true })
      },
      {
        id: "stage",
        header: "Stage",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-xs">{row.original.stage_name ?? "Unassigned"}</span>
        ),
        meta: columnMeta<EncounterReportsRow>({
          category: "meta",
          defaultHidden: true,
          responsive: "lg"
        })
      },
      {
        id: "round",
        header: "Round",
        enableSorting: false,
        cell: ({ row }) => <span className="text-xs tabular-nums">{row.original.round}</span>,
        meta: columnMeta<EncounterReportsRow>({
          category: "meta",
          defaultHidden: true,
          align: "center",
          numeric: true
        })
      },
      {
        id: "best_of",
        header: "Best of",
        enableSorting: false,
        cell: ({ row }) => <span className="text-xs tabular-nums">{row.original.best_of}</span>,
        meta: columnMeta<EncounterReportsRow>({
          category: "meta",
          defaultHidden: true,
          align: "center",
          numeric: true
        })
      },
      {
        id: "tournament",
        header: "Tournament",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-xs">{row.original.tournament_name ?? `#${row.original.tournament_id}`}</span>
        ),
        meta: columnMeta<EncounterReportsRow>({
          category: "meta",
          // The encounter cell already names it whenever the scope is wider
          // than one tournament; as its own column it is a duplicate.
          defaultHidden: true,
          responsive: "lg"
        })
      },
      {
        id: "resolution",
        header: "Last resolution",
        enableSorting: false,
        cell: ({ row }) => {
          const resolution = row.original.last_resolution;
          if (!resolution) return <span className="text-xs text-muted-foreground">{DASH}</span>;
          return (
            <div className="text-xs">
              <p className="truncate">
                {resolution.action} by {resolution.actor_name ?? "an automated process"}
              </p>
              <p className="tabular-nums text-muted-foreground">{fmtDate(format, resolution.created_at)}</p>
            </div>
          );
        },
        meta: columnMeta<EncounterReportsRow>({
          category: "admin",
          defaultHidden: true,
          responsive: "lg",
          className: "min-w-[180px]"
        })
      },
      {
        id: "encounter_id",
        header: "ID",
        enableSorting: false,
        cell: ({ row }) => <span className="text-xs tabular-nums">{row.original.id}</span>,
        meta: columnMeta<EncounterReportsRow>({
          category: "admin",
          defaultHidden: true,
          numeric: true
        })
      },
      // One column per organizer-defined question. Off by default: a form may
      // define a dozen, and they are only labelled while a single tournament
      // is in scope.
      ...customFields.map((field) =>
        sidesColumn(
          `custom_${field.key}`,
          field.label,
          (report) => report?.custom_fields[field.key] ?? "",
          {
            category: "admin",
            defaultHidden: true,
            responsive: "lg",
            className: "min-w-[160px] max-w-[240px]"
          }
        )
      )
    ],
    [showTournament, customFields, format]
  );
}
