"use client";

import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ClipboardCheck, Clock3, ScrollText } from "lucide-react";

import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminFilterChips, type AdminFilterChipOption } from "@/components/admin/AdminFilterChips";
import { AdminReportPairCell } from "@/components/admin/AdminReportPairCell";
import { ResolveResultDialog } from "@/components/admin/ResolveResultDialog";
import { StatTile, StatTileGrid } from "@/components/admin/StatTile";
import { TONE_CLASS } from "@/components/admin/tone";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import adminService from "@/services/admin.service";
import type { EncounterReportsQuery, EncounterReportsRow } from "@/types/admin.types";
import { invalidateTournamentWorkspace } from "@/app/admin/tournaments/[id]/components/tournamentWorkspace.queryKeys";

const PAGE_SIZE = 25;

/**
 * Chips are mutually exclusive and each maps to exactly one server filter.
 *
 * `disputed` and `mismatch` look alike but are not: `disputed` is the recorded
 * result state, `mismatch` is the live disagreement between two reports. An
 * encounter can be one without the other — a dispute an admin already settled
 * still has two divergent reports on file.
 */
type Chip = "all" | "disputed" | "mismatch" | "awaiting" | "unreported";

const CHIP_OPTIONS: readonly AdminFilterChipOption<Chip>[] = [
  { value: "all", label: "All" },
  { value: "disputed", label: "Disputed" },
  { value: "mismatch", label: "Reports disagree" },
  { value: "awaiting", label: "Awaiting second" },
  { value: "unreported", label: "No reports" }
];

function chipFilters(chip: Chip): Partial<EncounterReportsQuery> {
  switch (chip) {
    case "disputed":
      return { result_status: ["disputed"] };
    case "mismatch":
      return { mismatch_only: true };
    case "awaiting":
      return { reported_count: 1 };
    case "unreported":
      return { reported_count: 0 };
    default:
      return {};
  }
}

/**
 * Captain reports, for one tournament or for the whole workspace.
 *
 * One component rather than a hub tab and a near-identical browser page: the
 * two differ only by whether `tournamentId` is pinned, and a second copy of a
 * table with this much derived state would drift within a release.
 *
 * A dispute used to be invisible outside the per-encounter dialog; this lists
 * what needs attention and hands each row to the one write surface that can
 * settle it.
 *
 * The rows go through `AdminDataTable`, the same browser every other admin list
 * uses, which is where URL-persisted paging and search, rows-per-page, the
 * numbered pager, the refetch indicator and keyboard row activation come from.
 */
export function EncounterReportsBrowser({
  tournamentId,
  workspaceId,
  canUpdateEncounter
}: Readonly<{
  /** `null` = every tournament in the workspace. */
  tournamentId: number | null;
  workspaceId: number | null;
  canUpdateEncounter: boolean;
}>) {
  const queryClient = useQueryClient();
  const [resolving, setResolving] = useState<EncounterReportsRow | null>(null);
  const [chip, setChip] = useState<Chip>("all");
  const showTournament = tournamentId == null;

  const scopeParams = useMemo<EncounterReportsQuery | null>(
    () =>
      workspaceId == null
        ? null
        : { workspace_id: workspaceId, tournament_id: tournamentId ?? undefined },
    [workspaceId, tournamentId]
  );

  // Counters take the scope alone — not the chip, and not the search box. The
  // numbers answer "how much in this scope needs attention", so they stay put
  // while the admin clicks between chips or looks one encounter up, instead of
  // collapsing to whatever is currently on screen.
  const statsQuery = useQuery({
    queryKey: ["encounter-reports", "stats", scopeParams],
    queryFn: () => adminService.getEncounterReportStats(scopeParams!),
    enabled: scopeParams != null
  });

  const stats = statsQuery.data;

  const columns = useMemo<ColumnDef<EncounterReportsRow>[]>(
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
        )
      },
      {
        id: "teams",
        header: "Recorded teams",
        enableSorting: false,
        cell: ({ row }) => (
          <p className="max-w-[16rem] truncate text-xs text-muted-foreground">
            {row.original.home_team?.name ?? "?"} vs {row.original.away_team?.name ?? "?"}
          </p>
        )
      },
      {
        id: "reports",
        header: "Captain reports",
        size: 320,
        enableSorting: false,
        cell: ({ row }) => (
          <AdminReportPairCell
            homeReport={row.original.home_report}
            awayReport={row.original.away_report}
            scoresMatch={row.original.scores_match}
            seriesScoreValid={row.original.series_score_valid}
          />
        )
      },
      {
        id: "result",
        header: "Result",
        size: 132,
        enableSorting: false,
        cell: ({ row }) => (
          <div className="space-y-1">
            <Badge
              className={cn(
                TONE_CLASS[row.original.result_status === "disputed" ? "danger" : "neutral"]
              )}
            >
              {row.original.result_status}
            </Badge>
            {row.original.last_resolution ? (
              <p className="text-[11px] text-muted-foreground">
                {row.original.last_resolution.action} by{" "}
                {row.original.last_resolution.actor_name ?? "an automated process"}
              </p>
            ) : null}
          </div>
        )
      },
      // Deliberately not the `actions` column id: that one fades in on row hover,
      // which is right for a secondary icon but wrong for the single action this
      // whole page exists to offer.
      {
        id: "resolve",
        header: () => <span className="sr-only">Actions</span>,
        size: 104,
        enableSorting: false,
        cell: ({ row }) =>
          canUpdateEncounter ? (
            <div className="flex justify-end">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setResolving(row.original)}
              >
                {row.original.result_status === "confirmed" ? "Review" : "Resolve"}
              </Button>
            </div>
          ) : null
      }
    ],
    [showTournament, canUpdateEncounter]
  );

  if (workspaceId == null) {
    return (
      <div className="rounded-lg border border-dashed border-border/70 px-4 py-6 text-sm text-muted-foreground">
        Captain reports are scoped to a workspace. Pick one to see what has been reported.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <StatTileGrid>
        <StatTile
          label="Confirmed"
          value={stats?.by_result_status.confirmed ?? 0}
          icon={ClipboardCheck}
          tone="success"
        />
        <StatTile
          label="Disputed"
          value={stats?.by_result_status.disputed ?? 0}
          detail="Recorded result state"
          icon={AlertTriangle}
          tone="danger"
        />
        <StatTile
          label="Reports disagree"
          value={stats?.mismatch_count ?? 0}
          detail="Both captains reported, scores differ"
          icon={ScrollText}
          tone="warning"
        />
        <StatTile
          label="Awaiting second"
          value={stats?.awaiting_second_count ?? 0}
          detail="One captain has reported"
          icon={Clock3}
          tone="info"
        />
      </StatTileGrid>

      <p className="text-sm text-muted-foreground">
        Both captains report independently. Matching scores confirm the encounter; a disagreement
        marks it disputed.
      </p>

      <AdminDataTable
        columns={columns}
        filterKey={chip}
        initialPageSize={PAGE_SIZE}
        searchPlaceholder="Search team or encounter"
        emptyMessage={
          chip === "all" ? "No encounters here yet." : "No encounters match this filter."
        }
        actions={
          <AdminFilterChips
            label="Filter captain reports"
            options={CHIP_OPTIONS}
            value={chip}
            onChange={setChip}
          />
        }
        onRowClick={canUpdateEncounter ? (row) => setResolving(row.original) : undefined}
        queryKey={(page, search, pageSize) => [
          "encounter-reports",
          { workspaceId, tournamentId, chip, page, search, pageSize }
        ]}
        queryFn={(page, search, pageSize) =>
          adminService.listEncounterReports({
            workspace_id: workspaceId,
            tournament_id: tournamentId ?? undefined,
            query: search || undefined,
            ...chipFilters(chip),
            page,
            per_page: pageSize
          })
        }
      />

      <ResolveResultDialog
        row={resolving}
        open={resolving != null}
        onOpenChange={(next) => setResolving(next ? resolving : null)}
        onResolved={() => {
          // A settled result moves the encounter, the standings and the
          // bracket, so the invalidation is wider than this list. Scoped to
          // prefixes rather than exact keys because the list key carries the
          // whole filter object and every variant of it is now stale.
          void queryClient.invalidateQueries({ queryKey: ["encounter-reports"] });
          void queryClient.invalidateQueries({ queryKey: ["encounters"] });
          void queryClient.invalidateQueries({ queryKey: ["admin-matches"] });
          void queryClient.invalidateQueries({
            queryKey: tournamentId == null ? ["standings"] : ["standings", tournamentId]
          });
          if (tournamentId != null) {
            invalidateTournamentWorkspace(queryClient, tournamentId, workspaceId);
          }
        }}
      />
    </div>
  );
}
