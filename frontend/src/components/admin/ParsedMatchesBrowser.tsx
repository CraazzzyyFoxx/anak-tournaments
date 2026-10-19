"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";

import { DataTable, columnMeta } from "@/components/data-table";
import { ParsedMatchDetail } from "@/components/admin/ParsedMatchDetail";
import { FilterBar } from "@/components/kit/FilterBar";
import { Inspector } from "@/components/kit/Inspector";
import { useFilters, type FilterDef } from "@/components/kit/useFilters";
import { StatusPill } from "@/components/kit/StatusPill";
import { type Tone } from "@/components/kit/tone";
import {
  TOURNAMENT_QUERY_PARAM,
  parseTournamentQueryParam
} from "@/components/admin/tournament-filter";
import { useQueryParams } from "@/hooks/useQueryParams";
import { cn } from "@/lib/utils";
import adminService from "@/services/admin.service";
import { scoreLine } from "@/lib/encounter/detail";
import tournamentService from "@/services/tournament.service";
import type { AdminMatchRow, LogProcessingStatus } from "@/types/admin.types";
import { EmptyNote } from "@/components/kit/EmptyNote";
import { useCatalogEntities } from "@/hooks/useCatalogEntities";
import { tournamentQueryKeys } from "@/lib/tournament/query-keys";

const PAGE_SIZE = 25;

const STATUS_TONE: Record<LogProcessingStatus, Tone> = {
  pending: "neutral",
  processing: "info",
  awaiting_link: "neutral",
  done: "success",
  failed: "danger"
};

/**
 * Every ingestion status a provenance cell can print.
 *
 * A missing raw log is not an ingestion status. The endpoint selects matches
 * without a linked job through the separate `unlinked_only` filter.
 */
const LOG_STATUS_OPTIONS: readonly { value: LogProcessingStatus; label: LogProcessingStatus }[] = [
  { value: "pending", label: "pending" },
  { value: "processing", label: "processing" },
  { value: "awaiting_link", label: "awaiting_link" },
  { value: "done", label: "done" },
  { value: "failed", label: "failed" }
];

/**
 * Parsed matches — one row per played map — for one tournament or the whole
 * workspace.
 *
 * Until `mtchlog001` `Encounter.has_logs` was the only admin-visible sign that
 * any of this existed: a boolean on the encounter that could not say which
 * upload produced which map, or whether a map had been parsed at all.
 *
 * Filtering lives in `FilterBar` and row detail in `Inspector`, the
 * two surfaces every admin browser uses, so what an admin narrowed to travels
 * in the URL and the table stays visible beside the map being investigated.
 */
export function ParsedMatchesBrowser({
  tournamentId,
  discipline,
  workspaceId,
  tournamentName
}: Readonly<{
  /** `null` = every tournament in the workspace. */
  tournamentId: number | null;
  /** The game whose maps the filter offers: the pinned tournament's, else the browsing choice; `null` = none yet. */
  discipline: string | null;
  workspaceId: number | null;
  /** Names the pinned chip inside a hub; the chip reads `#id` without it. */
  tournamentName?: string | null;
}>) {
  const t = useTranslations("adminMatches.parsed");
  // `id` is the inspector, not a filter: opening a map must not drop the page
  // it sits on.
  const { searchParams, setParams } = useQueryParams({ resetOnChange: [], shallow: true });
  const openId = searchParams?.get("id") ?? null;
  const [pageRows, setPageRows] = useState<AdminMatchRow[]>([]);
  const showTournament = tournamentId == null;

  const chipTournamentId = parseTournamentQueryParam(
    searchParams?.get(TOURNAMENT_QUERY_PARAM) ?? null
  );
  const scopeTournamentId = tournamentId ?? chipTournamentId;

  // Map options come from the game's catalogue, not from the page of rows: the
  // filter has to offer maps that this page happens not to show.
  const mapsQuery = useCatalogEntities(discipline, "map", { enabled: workspaceId != null });

  const tournamentsQuery = useQuery({
    queryKey: tournamentQueryKeys.list(),
    queryFn: () => tournamentService.getAll(null),
    enabled: workspaceId != null && tournamentId == null
  });

  const defs = useMemo<FilterDef[]>(() => {
    const list: FilterDef[] = [];
    if (tournamentId == null) {
      list.push({
        key: TOURNAMENT_QUERY_PARAM,
        label: t("tournament"),
        kind: "single",
        options: (tournamentsQuery.data?.results ?? []).map((entry) => ({
          value: String(entry.id),
          label: entry.name
        }))
      });
    }
    list.push(
      {
        key: "map_id",
        label: t("map"),
        kind: "single",
        options: (mapsQuery.data ?? []).map((entry) => ({
          value: String(entry.id),
          label: entry.name
        }))
      },
      {
        key: "log_status",
        label: t("ingestionStatus"),
        kind: "multi",
        options: LOG_STATUS_OPTIONS.map((option) => ({
          ...option,
          label: t(option.label)
        }))
      },
      // No linked raw log, not an ingestion failure.
      { key: "unlinked_only", label: t("noRawLog"), kind: "toggle" }
    );
    return list;
  }, [tournamentId, tournamentsQuery.data, mapsQuery.data, t]);

  const filters = useFilters(defs);
  const mapFilter = String(filters.values.map_id ?? "");
  const statusFilter = Array.isArray(filters.values.log_status)
    ? (filters.values.log_status as LogProcessingStatus[])
    : [];
  const unlinkedOnly = filters.values.unlinked_only === true;

  // The inspector shows a row from the page on screen, so a deep-linked `?id=`
  // the current chips exclude leaves it closed rather than showing detail for a
  // map the list does not contain.
  const openRow = pageRows.find((row) => String(row.id) === openId) ?? null;
  const openIndex = openRow ? pageRows.indexOf(openRow) : -1;

  const columns = useMemo<ColumnDef<AdminMatchRow>[]>(
    () => [
      {
        id: "map",
        header: t("map"),
        // The server sorts none of these, so offering a sort control would be a
        // lie the header cannot honour.
        enableSorting: false,
        cell: ({ row }) => (
          <div className="min-w-0 max-w-[20rem]">
            <p className="truncate font-medium text-foreground" title={row.original.map.name}>
              {row.original.map.name}
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
        header: t("score"),
        size: 92,
        enableSorting: false,
        cell: ({ row }) => (
          <span className="font-mono text-sm tabular-nums text-foreground">
            {scoreLine(row.original.participants)}
          </span>
        )
      },
      {
        id: "log",
        header: t("log"),
        enableSorting: false,
        cell: ({ row }) => (
          <p
            className="max-w-[18rem] truncate font-mono text-xs text-muted-foreground"
            title={row.original.log_name ?? undefined}
          >
            {row.original.log_name ?? "—"}
          </p>
        )
      },
      {
        id: "provenance",
        header: t("provenance"),
        size: 148,
        enableSorting: false,
        meta: columnMeta<AdminMatchRow>({ align: "center" }),
        cell: ({ row }) =>
          row.original.log_record ? (
            <StatusPill tone={STATUS_TONE[row.original.log_record.status]}>
              {row.original.log_record.status}
            </StatusPill>
          ) : (
            <StatusPill tone="neutral">{t("noRawLog")}</StatusPill>
          )
      }
    ],
    [showTournament, t]
  );

  if (workspaceId == null) {
    return (
      <EmptyNote>
        {t("scopePrompt")}
      </EmptyNote>
    );
  }

  return (
    <div className="space-y-3">
      <div
        className={cn("grid items-start gap-4", openRow && "lg:grid-cols-[minmax(0,1fr)_380px]")}
      >
        <div className="min-w-0">
          <DataTable<AdminMatchRow>
            columns={columns}
            filterKey={filters.filterKey}
            initialPageSize={PAGE_SIZE}
            searchPlaceholder={t("search")}
            inspectorId={openId}
            getRowId={(row) => String(row.id)}
            toolbar={
              <FilterBar
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
            emptyMessage={
              unlinkedOnly
                ? t("emptyNoRawLog")
                : t("empty")
            }
            onRowClick={(row) => setParams({ id: String(row.original.id) })}
            renderMobileCard={(row) => (
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{row.original.map.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {row.original.encounter_name} ·{" "}
                  <span className="font-mono tabular-nums">
                    {scoreLine(row.original.participants)}
                  </span>
                </p>
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {row.original.log_record?.status ?? t("noRawLog")}
                </p>
              </div>
            )}
            queryKey={(page, search, pageSize) => [
              "admin-matches",
              {
                workspaceId,
                tournamentId: scopeTournamentId,
                chip: unlinkedOnly ? "no-raw-log" : "all",
                page,
                search,
                pageSize,
                filters: { map_id: mapFilter, log_status: statusFilter }
              }
            ]}
            queryFn={(page, search, pageSize) =>
              adminService.listAdminMatches({
                workspace_id: workspaceId,
                tournament_id: scopeTournamentId ?? undefined,
                query: search || undefined,
                map_id: mapFilter ? Number(mapFilter) : undefined,
                log_status: statusFilter.length ? statusFilter : undefined,
                ...(unlinkedOnly && { unlinked_only: true }),
                page,
                per_page: pageSize
              })
            }
            onPageRowsChange={setPageRows}
          />
        </div>

        <Inspector
          openId={openRow ? openId : null}
          onClose={() => setParams({ id: null })}
          title={openRow?.map.name ?? ""}
          subtitle={
            openRow ? `${openRow.encounter_name} · ${openRow.tournament_name}` : undefined
          }
          onPrev={
            openIndex > 0 ? () => setParams({ id: String(pageRows[openIndex - 1].id) }) : undefined
          }
          onNext={
            openIndex >= 0 && openIndex < pageRows.length - 1
              ? () => setParams({ id: String(pageRows[openIndex + 1].id) })
              : undefined
          }
        >
          {openRow ? <ParsedMatchDetail row={openRow} workspaceId={workspaceId} /> : null}
        </Inspector>
      </div>
    </div>
  );
}
