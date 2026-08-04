"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDebounce } from "use-debounce";

import { ParsedMatchSheet } from "@/components/admin/ParsedMatchSheet";
import { TONE_CLASS, type Tone } from "@/components/admin/tone";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import adminService from "@/services/admin.service";
import type { AdminMatchRow, AdminMatchesQuery, LogProcessingStatus } from "@/types/admin.types";

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;

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

const CHIP_LABELS: Record<Chip, string> = {
  all: "All",
  failed: "Ingestion failed",
  unresolved: "Provenance unresolved"
};

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
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, SEARCH_DEBOUNCE_MS);
  const [inspecting, setInspecting] = useState<AdminMatchRow | null>(null);

  const params = useMemo<AdminMatchesQuery | null>(
    () =>
      workspaceId == null
        ? null
        : {
            workspace_id: workspaceId,
            tournament_id: tournamentId ?? undefined,
            query: debouncedSearch || undefined,
            ...chipFilters(chip),
            page,
            per_page: PAGE_SIZE
          },
    [workspaceId, tournamentId, debouncedSearch, chip, page]
  );

  const listQuery = useQuery({
    queryKey: ["admin-matches", params],
    queryFn: () => adminService.listAdminMatches(params!),
    enabled: params != null
  });

  const rows = listQuery.data?.results ?? [];
  const total = listQuery.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="gap-3">
          <div>
            <CardTitle>Parsed matches</CardTitle>
            <CardDescription>
              One row per played map, as the log parser produced it. Provenance is the ingestion
              record the map came from.
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
                onClick={() => {
                  setChip(key);
                  setPage(1);
                }}
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
              placeholder="Search log name, code or team"
              className="h-8 w-full max-w-xs"
              aria-label="Search parsed matches"
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {listQuery.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }, (_, index) => (
                <Skeleton key={index} className="h-16 w-full rounded-xl" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No parsed maps match this filter.
            </p>
          ) : (
            <ul className="space-y-2">
              {rows.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => setInspecting(row)}
                    className="flex w-full flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-card/40 p-3 text-left transition-colors hover:bg-card/70"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">
                        {row.map_name}
                        <span className="ml-2 font-mono text-xs tabular-nums text-muted-foreground">
                          {row.home_score} &ndash; {row.away_score}
                        </span>
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {tournamentId == null ? `${row.tournament_name} · ` : ""}
                        {row.encounter_name}
                      </p>
                      <p className="truncate font-mono text-xs text-muted-foreground">
                        {row.log_name}
                      </p>
                    </div>
                    {row.log_record ? (
                      <Badge className={cn("shrink-0", TONE_CLASS[STATUS_TONE[row.log_record.status]])}>
                        {row.log_record.status}
                      </Badge>
                    ) : (
                      // Never "failed": no record is unknown provenance, and the
                      // word carries the whole meaning so the state survives
                      // greyscale.
                      <Badge className={cn("shrink-0", TONE_CLASS.neutral)}>unresolved</Badge>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {pageCount > 1 ? (
            <div className="flex items-center justify-between pt-2">
              <p className="text-xs text-muted-foreground">
                Page {page} of {pageCount} · {total} maps
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

      <ParsedMatchSheet
        row={inspecting}
        workspaceId={workspaceId}
        open={inspecting != null}
        onOpenChange={(next) => setInspecting(next ? inspecting : null)}
      />
    </div>
  );
}
