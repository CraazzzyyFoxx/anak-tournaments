"use client";

import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ClipboardCheck, Clock3, Gavel, ScrollText } from "lucide-react";

import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminReportPairCell } from "@/components/admin/AdminReportPairCell";
import { ResolveResultDialog } from "@/components/admin/ResolveResultDialog";
import { StatTile, StatTileGrid } from "@/components/admin/StatTile";
import { AdminFilterBar } from "@/components/admin/kit/AdminFilterBar";
import { AdminInspector } from "@/components/admin/kit/AdminInspector";
import { useAdminFilters, type FilterDef } from "@/components/admin/kit/useAdminFilters";
import { EYEBROW_CLASS, TONE_CLASS } from "@/components/admin/tone";
import {
  TOURNAMENT_QUERY_PARAM,
  parseTournamentQueryParam
} from "@/components/admin/tournament-filter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useQueryParams } from "@/hooks/useQueryParams";
import { cn } from "@/lib/utils";
import adminService from "@/services/admin.service";
import tournamentService from "@/services/tournament.service";
import type { EncounterReportsQuery, EncounterReportsRow } from "@/types/admin.types";
import { invalidateTournamentWorkspace } from "@/app/admin/tournaments/[id]/components/tournamentWorkspace.queryKeys";
import { EmptyNote } from "@/components/admin/kit/EmptyNote";

const PAGE_SIZE = 25;

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
 * Filters are chips in `AdminFilterBar` and the row detail is `AdminInspector`,
 * so a narrowed list and the open row both travel in the URL — a disputed
 * encounter can be pasted to whoever has to settle it.
 */
export function EncounterReportsBrowser({
  tournamentId,
  workspaceId,
  canUpdateEncounter,
  tournamentName
}: Readonly<{
  /** `null` = every tournament in the workspace. */
  tournamentId: number | null;
  workspaceId: number | null;
  canUpdateEncounter: boolean;
  /** Names the pinned chip inside a hub; the chip reads `#id` without it. */
  tournamentName?: string | null;
}>) {
  const queryClient = useQueryClient();
  // `id` is the inspector, not a filter: opening a row must not drop its page.
  const { searchParams, setParams } = useQueryParams({ resetOnChange: [] });
  const openId = searchParams?.get("id") ?? null;
  const [pageRows, setPageRows] = useState<EncounterReportsRow[]>([]);
  const [resolving, setResolving] = useState<EncounterReportsRow | null>(null);
  const showTournament = tournamentId == null;

  const chipTournamentId = parseTournamentQueryParam(
    searchParams?.get(TOURNAMENT_QUERY_PARAM) ?? null
  );
  const scopeTournamentId = tournamentId ?? chipTournamentId;

  const scopeParams = useMemo<EncounterReportsQuery | null>(
    () =>
      workspaceId == null
        ? null
        : { workspace_id: workspaceId, tournament_id: scopeTournamentId ?? undefined },
    [workspaceId, scopeTournamentId]
  );

  // Counters take the scope alone — not the chips, not the search box. The
  // numbers answer "how much in this scope needs attention", so they stay put
  // while the admin narrows the list or looks one encounter up, instead of
  // collapsing to what is on screen.
  const statsQuery = useQuery({
    queryKey: ["encounter-reports", "stats", scopeParams],
    queryFn: () => adminService.getEncounterReportStats(scopeParams!),
    enabled: scopeParams != null
  });

  const tournamentsQuery = useQuery({
    queryKey: ["tournaments"],
    queryFn: () => tournamentService.getAll(null),
    enabled: workspaceId != null && tournamentId == null
  });

  const stagesQuery = useQuery({
    queryKey: ["admin", "stages", scopeTournamentId],
    queryFn: () => adminService.getStages(scopeTournamentId!),
    enabled: scopeTournamentId != null
  });

  const stats = statsQuery.data;

  const defs = useMemo<FilterDef[]>(() => {
    const list: FilterDef[] = [];
    if (tournamentId == null) {
      list.push({
        key: TOURNAMENT_QUERY_PARAM,
        label: "Tournament",
        kind: "single",
        options: (tournamentsQuery.data?.results ?? []).map((entry) => ({
          value: String(entry.id),
          label: entry.name
        }))
      });
    }
    if ((stagesQuery.data ?? []).length > 0) {
      list.push({
        key: "stage",
        label: "Stage",
        kind: "single",
        options: (stagesQuery.data ?? []).map((stage) => ({
          value: String(stage.id),
          label: stage.name
        }))
      });
    }
    list.push(
      {
        key: "result_status",
        label: "Result",
        // The endpoint's field is a list and the service repeats the param once
        // per checked value, so this narrows to several states at once.
        kind: "multi",
        options: [
          { value: "none", label: "None" },
          { value: "pending_confirmation", label: "Pending confirmation" },
          { value: "confirmed", label: "Confirmed" },
          { value: "disputed", label: "Disputed" }
        ]
      },
      {
        key: "reported_count",
        label: "Reports filed",
        // `reported_count` is a scalar on the endpoint, so this is single
        // select: "0 or 2" is not a question the query param can ask.
        kind: "single",
        options: [
          { value: "0", label: "No reports" },
          { value: "1", label: "Awaiting second" },
          { value: "2", label: "Both reported" }
        ]
      },
      // Looks like `result_status: disputed` but is not: that is the recorded
      // result state, this is the live disagreement between two reports. A
      // dispute an admin already settled still has two divergent reports on
      // file, which is why they are two filters.
      { key: "mismatch_only", label: "Reports disagree", kind: "toggle" }
    );
    return list;
  }, [tournamentId, tournamentsQuery.data, stagesQuery.data]);

  const filters = useAdminFilters(defs);
  const stageFilter = String(filters.values.stage ?? "");
  const resultStatusFilter = Array.isArray(filters.values.result_status)
    ? (filters.values.result_status as string[])
    : [];
  const reportedCountFilter = String(filters.values.reported_count ?? "");
  const mismatchOnly = filters.values.mismatch_only === true;

  // The inspector shows a row from the page on screen, so a deep-linked `?id=`
  // the current chips exclude leaves it closed rather than showing detail for
  // an encounter the list does not contain.
  const openRow = pageRows.find((row) => String(row.id) === openId) ?? null;
  const openIndex = openRow ? pageRows.indexOf(openRow) : -1;

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
              <p className="text-xs text-muted-foreground">
                {row.original.last_resolution.action} by{" "}
                {row.original.last_resolution.actor_name ?? "an automated process"}
              </p>
            ) : null}
          </div>
        )
      }
    ],
    [showTournament]
  );

  if (workspaceId == null) {
    return (
      <EmptyNote>
        Captain reports are scoped to a workspace. Pick one to see what has been reported.
      </EmptyNote>
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

      <div
        className={cn("grid items-start gap-4", openRow && "lg:grid-cols-[minmax(0,1fr)_380px]")}
      >
        <div className="min-w-0">
          <AdminDataTable<EncounterReportsRow>
            columns={columns}
            filterKey={filters.filterKey}
            initialPageSize={PAGE_SIZE}
            searchPlaceholder="Search team or encounter"
            inspectorId={openId}
            getRowId={(row) => String(row.id)}
            toolbar={
              <AdminFilterBar
                defs={defs}
                filters={filters}
                pinned={
                  tournamentId != null
                    ? [
                        {
                          key: TOURNAMENT_QUERY_PARAM,
                          label: `Tournament: ${tournamentName ?? `#${tournamentId}`}`
                        }
                      ]
                    : undefined
                }
              />
            }
            emptyMessage="No encounters match this filter."
            onRowClick={(row) => setParams({ id: String(row.original.id) })}
            renderMobileCard={(row) => (
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{row.original.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {row.original.home_team?.name ?? "?"} vs {row.original.away_team?.name ?? "?"} ·{" "}
                  {row.original.reported_count}/2 reported
                </p>
                <p className="text-xs text-muted-foreground">{row.original.result_status}</p>
              </div>
            )}
            queryKey={(page, search, pageSize) => [
              "encounter-reports",
              {
                workspaceId,
                tournamentId: scopeTournamentId,
                mismatchOnly,
                page,
                search,
                pageSize,
                filters: {
                  stage: stageFilter,
                  result_status: resultStatusFilter,
                  reported_count: reportedCountFilter
                }
              }
            ]}
            queryFn={async (page, search, pageSize) => {
              const result = await adminService.listEncounterReports({
                workspace_id: workspaceId,
                tournament_id: scopeTournamentId ?? undefined,
                stage_id: stageFilter ? Number(stageFilter) : undefined,
                query: search || undefined,
                result_status: resultStatusFilter.length ? resultStatusFilter : undefined,
                // Zero is a real value here ("neither captain reported"), so the
                // guard is on the string, never on the number.
                reported_count: reportedCountFilter ? Number(reportedCountFilter) : undefined,
                mismatch_only: mismatchOnly || undefined,
                page,
                per_page: pageSize
              });
              // The inspector pages through the rows on screen, and the table
              // owns the fetch, so this is where that page is observed.
              setPageRows(result.results);
              return result;
            }}
          />
        </div>

        <AdminInspector
          openId={openRow ? openId : null}
          onClose={() => setParams({ id: null })}
          title={openRow ? openRow.name : ""}
          subtitle={
            openRow
              ? `${showTournament ? `${openRow.tournament_name ?? "Unknown tournament"} · ` : ""}${openRow.stage_name ?? "Unassigned"} · Round ${openRow.round} · BO${openRow.best_of}`
              : undefined
          }
          onPrev={
            openIndex > 0 ? () => setParams({ id: String(pageRows[openIndex - 1].id) }) : undefined
          }
          onNext={
            openIndex >= 0 && openIndex < pageRows.length - 1
              ? () => setParams({ id: String(pageRows[openIndex + 1].id) })
              : undefined
          }
          actions={
            openRow && canUpdateEncounter ? (
              <Button type="button" size="sm" variant="secondary" onClick={() => setResolving(openRow)}>
                <Gavel aria-hidden className="size-3.5" />
                {openRow.result_status === "confirmed" ? "Review result" : "Resolve result"}
              </Button>
            ) : null
          }
        >
          {openRow ? (
            <div className="space-y-4">
              <AdminReportPairCell
                homeReport={openRow.home_report}
                awayReport={openRow.away_report}
                scoresMatch={openRow.scores_match}
                seriesScoreValid={openRow.series_score_valid}
              />

              <div className="grid grid-cols-2 gap-3">
                <div className="min-w-0">
                  <p className={EYEBROW_CLASS}>Recorded teams</p>
                  <p className="truncate text-sm">
                    {openRow.home_team?.name ?? "?"} vs {openRow.away_team?.name ?? "?"}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className={EYEBROW_CLASS}>Result</p>
                  <p className="truncate text-sm">{openRow.result_status}</p>
                </div>
                <div className="min-w-0">
                  <p className={EYEBROW_CLASS}>Encounter status</p>
                  <p className="truncate text-sm">{openRow.status}</p>
                </div>
                <div className="min-w-0">
                  <p className={EYEBROW_CLASS}>Reports filed</p>
                  <p className="truncate text-sm tabular-nums">{openRow.reported_count}/2</p>
                </div>
              </div>

              {openRow.last_resolution ? (
                <section className="rounded-xl border border-border/60 p-3">
                  <p className={EYEBROW_CLASS}>Last resolution</p>
                  <p className="mt-1 text-sm">
                    {openRow.last_resolution.action} by{" "}
                    {openRow.last_resolution.actor_name ?? "an automated process"}
                  </p>
                  <p className="text-xs tabular-nums text-muted-foreground">
                    {new Date(openRow.last_resolution.created_at).toLocaleString()}
                  </p>
                </section>
              ) : null}
            </div>
          ) : null}
        </AdminInspector>
      </div>

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
            queryKey: scopeTournamentId == null ? ["standings"] : ["standings", scopeTournamentId]
          });
          if (scopeTournamentId != null) {
            invalidateTournamentWorkspace(queryClient, scopeTournamentId, workspaceId);
          }
        }}
      />
    </div>
  );
}
