"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ClipboardCheck, Clock3, ScrollText } from "lucide-react";
import { useDebounce } from "use-debounce";

import { AdminReportPairCell } from "@/components/admin/AdminReportPairCell";
import { StatTile, StatTileGrid } from "@/components/admin/StatTile";
import { TONE_CLASS } from "@/components/admin/tone";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import adminService from "@/services/admin.service";
import type { EncounterReportsQuery, EncounterReportsRow } from "@/types/admin.types";

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Chips are mutually exclusive and each maps to exactly one server filter.
 *
 * `disputed` and `mismatch` look alike but are not: `disputed` is the recorded
 * result state, `mismatch` is the live disagreement between two reports. An
 * encounter can be one without the other — a dispute an admin already settled
 * still has two divergent reports on file.
 */
type Chip = "all" | "disputed" | "mismatch" | "awaiting" | "unreported";

const CHIP_LABELS: Record<Chip, string> = {
  all: "All",
  disputed: "Disputed",
  mismatch: "Reports disagree",
  awaiting: "Awaiting second",
  unreported: "No reports"
};

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
 * Captain reports for one tournament.
 *
 * Read-only: the resolve action lands with the resolve dialog. Until then this
 * shows which encounters need attention and why, which is already more than the
 * admin had — a dispute was previously invisible outside the encounter dialog.
 */
export function TournamentReportsTab({
  tournamentId,
  workspaceId
}: Readonly<{
  tournamentId: number;
  workspaceId: number | null;
}>) {
  const [chip, setChip] = useState<Chip>("all");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, SEARCH_DEBOUNCE_MS);

  const baseParams = useMemo<EncounterReportsQuery | null>(
    () =>
      workspaceId == null
        ? null
        : {
            workspace_id: workspaceId,
            tournament_id: tournamentId,
            query: debouncedSearch || undefined
          },
    [workspaceId, tournamentId, debouncedSearch]
  );

  const listParams = useMemo<EncounterReportsQuery | null>(
    () =>
      baseParams == null
        ? null
        : { ...baseParams, ...chipFilters(chip), page, per_page: PAGE_SIZE },
    [baseParams, chip, page]
  );

  const listQuery = useQuery({
    queryKey: ["encounter-reports", listParams],
    queryFn: () => adminService.listEncounterReports(listParams!),
    enabled: listParams != null
  });

  // Counters take the scope but not the chip, so the numbers stay put as the
  // admin clicks between chips instead of collapsing to the current selection.
  const statsQuery = useQuery({
    queryKey: ["encounter-reports", "stats", baseParams],
    queryFn: () => adminService.getEncounterReportStats(baseParams!),
    enabled: baseParams != null
  });

  const rows = listQuery.data?.results ?? [];
  const total = listQuery.data?.total ?? 0;
  const stats = statsQuery.data;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function selectChip(next: Chip) {
    setChip(next);
    setPage(1);
  }

  return (
    <div className="space-y-4">
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

      <Card>
        <CardHeader className="gap-3">
          <div>
            <CardTitle>Captain reports</CardTitle>
            <CardDescription>
              Both captains report independently. Matching scores confirm the encounter; a
              disagreement marks it disputed.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(Object.keys(CHIP_LABELS) as Chip[]).map((key) => (
              <Button
                key={key}
                type="button"
                size="sm"
                variant={chip === key ? "secondary" : "ghost"}
                aria-pressed={chip === key}
                onClick={() => selectChip(key)}
              >
                {CHIP_LABELS[key]}
              </Button>
            ))}
            <Input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search team or encounter"
              className="h-8 w-full max-w-xs"
              aria-label="Search captain reports"
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {listQuery.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }, (_, index) => (
                <Skeleton key={index} className="h-24 w-full rounded-xl" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No encounters match this filter.
            </p>
          ) : (
            <ul className="space-y-2">
              {rows.map((row) => (
                <ReportRow key={row.id} row={row} />
              ))}
            </ul>
          )}

          {pageCount > 1 ? (
            <div className="flex items-center justify-between pt-2">
              <p className="text-xs text-muted-foreground">
                Page {page} of {pageCount} · {total} encounters
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  Previous
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={page >= pageCount}
                  onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function ReportRow({ row }: Readonly<{ row: EncounterReportsRow }>) {
  const resolvedAt = row.last_resolution ? new Date(row.last_resolution.created_at) : null;
  return (
    <li className="rounded-xl border border-border/60 bg-card/40 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{row.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {row.stage_name ?? "Unassigned"} · Round {row.round} · BO{row.best_of}
          </p>
          <p className="mt-1 font-mono text-xs tabular-nums text-muted-foreground">
            Recorded {row.home_team?.name ?? "?"} vs {row.away_team?.name ?? "?"}
          </p>
        </div>
        <Badge className={cn("shrink-0", TONE_CLASS[row.result_status === "disputed" ? "danger" : "neutral"])}>
          {row.result_status}
        </Badge>
      </div>
      <AdminReportPairCell
        className="mt-3"
        homeReport={row.home_report}
        awayReport={row.away_report}
        scoresMatch={row.scores_match}
        seriesScoreValid={row.series_score_valid}
      />
      {row.last_resolution ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Last change: {row.last_resolution.action} by{" "}
          {row.last_resolution.actor_name ?? "an automated process"} ·{" "}
          {resolvedAt && !Number.isNaN(resolvedAt.getTime()) ? resolvedAt.toLocaleString() : "—"}
        </p>
      ) : null}
    </li>
  );
}
