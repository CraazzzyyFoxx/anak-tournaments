"use client";

import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";

import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminFilterChips, type AdminFilterChipOption } from "@/components/admin/AdminFilterChips";
import { ParsedMatchSheet } from "@/components/admin/ParsedMatchSheet";
import { TONE_CLASS, type Tone } from "@/components/admin/tone";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import adminService from "@/services/admin.service";
import type { AdminMatchRow, AdminMatchesQuery, LogProcessingStatus } from "@/types/admin.types";

const PAGE_SIZE = 25;

const STATUS_TONE: Record<LogProcessingStatus, Tone> = {
  pending: "neutral",
  processing: "info",
  done: "success",
  failed: "danger"
};

/**
 * Chips are mutually exclusive and each maps to one server filter.
 *
 * `unresolved` is not a failure bucket. It selects maps with no ingestion
 * record at all, which is most of the archive; `failed` selects the ones whose
 * ingestion actually broke. Merging them would drown the real failures.
 */
type Chip = "all" | "failed" | "unresolved";

const CHIP_OPTIONS: readonly AdminFilterChipOption<Chip>[] = [
  { value: "all", label: "All" },
  { value: "failed", label: "Ingestion failed" },
  { value: "unresolved", label: "Provenance unresolved" }
];

function chipFilters(chip: Chip): Partial<AdminMatchesQuery> {
  switch (chip) {
    case "failed":
      return { log_status: ["failed"] };
    case "unresolved":
      return { unlinked_only: true };
    default:
      return {};
  }
}

/**
 * Parsed matches — one row per played map — for one tournament or the whole
 * workspace.
 *
 * Until now `Encounter.has_logs` was the only admin-visible sign that any of
 * this existed: a boolean on the encounter that could not say which upload
 * produced which map, or whether a map had been parsed at all.
 *
 * The rows go through `AdminDataTable` rather than a hand-rolled list, which is
 * what every other admin browser uses. That is not only cosmetic: it is where
 * URL-persisted paging and search, rows-per-page, the numbered pager, the
 * refetch indicator and keyboard row activation come from. This page shipped
 * with none of them.
 */
export function ParsedMatchesBrowser({
  tournamentId,
  workspaceId
}: Readonly<{
  /** `null` = every tournament in the workspace. */
  tournamentId: number | null;
  workspaceId: number | null;
}>) {
  const [chip, setChip] = useState<Chip>("all");
  const [inspecting, setInspecting] = useState<AdminMatchRow | null>(null);
  const showTournament = tournamentId == null;

  const columns = useMemo<ColumnDef<AdminMatchRow>[]>(
    () => [
      {
        id: "map",
        header: "Map",
        // The server sorts none of these, so offering a sort control would be a
        // lie the header cannot honour.
        enableSorting: false,
        cell: ({ row }) => (
          <div className="min-w-0 max-w-[20rem]">
            <p className="truncate font-medium text-foreground" title={row.original.map_name}>
              {row.original.map_name}
            </p>
            <p
              className="truncate text-xs text-muted-foreground"
              title={
                showTournament
                  ? `${row.original.tournament_name} · ${row.original.encounter_name}`
                  : row.original.encounter_name
              }
            >
              {showTournament ? `${row.original.tournament_name} · ` : ""}
              {row.original.encounter_name}
            </p>
          </div>
        )
      },
      {
        id: "score",
        header: "Score",
        size: 92,
        enableSorting: false,
        cell: ({ row }) => (
          <span className="font-mono text-sm tabular-nums text-foreground">
            {row.original.home_score} &ndash; {row.original.away_score}
          </span>
        )
      },
      {
        id: "log",
        header: "Log",
        enableSorting: false,
        cell: ({ row }) => (
          <p
            className="max-w-[18rem] truncate font-mono text-xs text-muted-foreground"
            title={row.original.log_name}
          >
            {row.original.log_name}
          </p>
        )
      },
      {
        id: "provenance",
        header: "Provenance",
        size: 148,
        enableSorting: false,
        cell: ({ row }) =>
          row.original.log_record ? (
            <Badge className={cn(TONE_CLASS[STATUS_TONE[row.original.log_record.status]])}>
              {row.original.log_record.status}
            </Badge>
          ) : (
            // Never "failed": no record is unknown provenance, and the word
            // carries the whole meaning so the state survives greyscale.
            <Badge className={cn(TONE_CLASS.neutral)}>unresolved</Badge>
          )
      }
    ],
    [showTournament]
  );

  if (workspaceId == null) {
    return (
      <div className="rounded-lg border border-dashed border-border/70 px-4 py-6 text-sm text-muted-foreground">
        Parsed maps are scoped to a workspace. Pick one to see what the log parser produced.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        One row per played map, as the log parser produced it. Provenance is the ingestion record the
        map came from.
      </p>

      <AdminDataTable
        columns={columns}
        filterKey={chip}
        initialPageSize={PAGE_SIZE}
        searchPlaceholder="Search log name, code or team"
        emptyMessage={
          chip === "all" ? "No parsed maps here yet." : "No parsed maps match this filter."
        }
        actions={
          <AdminFilterChips
            label="Filter parsed matches"
            options={CHIP_OPTIONS}
            value={chip}
            onChange={setChip}
          />
        }
        onRowClick={(row) => setInspecting(row.original)}
        queryKey={(page, search, pageSize) => [
          "admin-matches",
          { workspaceId, tournamentId, chip, page, search, pageSize }
        ]}
        queryFn={(page, search, pageSize) =>
          adminService.listAdminMatches({
            workspace_id: workspaceId,
            tournament_id: tournamentId ?? undefined,
            query: search || undefined,
            ...chipFilters(chip),
            page,
            per_page: pageSize
          })
        }
      />

      <ParsedMatchSheet
        row={inspecting}
        workspaceId={workspaceId}
        open={inspecting != null}
        onOpenChange={(next) => setInspecting(next ? inspecting : null)}
      />
    </div>
  );
}
