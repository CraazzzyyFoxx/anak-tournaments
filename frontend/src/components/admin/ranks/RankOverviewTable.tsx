"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Building2,
  ClipboardList,
  EyeOff,
  Gamepad2,
  NotebookPen,
  Radar,
  Shuffle,
  Trophy,
  Users,
  type LucideIcon,
} from "lucide-react";

import DivisionIcon from "@/components/DivisionIcon";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import { DataTable, columnMeta } from "@/components/data-table";
import { EmptyNote } from "@/components/kit/EmptyNote";
import { FilterBar } from "@/components/kit/FilterBar";
import { formatDate } from "@/components/kit/format-time";
import { useFilters, type FilterDef } from "@/components/kit/useFilters";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { PageStateCard } from "@/components/ui/page-state-card";
import { Skeleton } from "@/components/ui/skeleton";
import { GameScopeControl } from "@/components/workspace/GameScopeControl";
import { useGameBoundParams } from "@/components/workspace/scope-pill-store";
import { useGameScope } from "@/hooks/useGameScope";
import { useDivisionGrid } from "@/hooks/useCurrentWorkspace";
import { useDisciplineMetadata } from "@/hooks/useDisciplineMetadata";
import { useQueryParams } from "@/hooks/useQueryParams";
import { useSlotLabel } from "@/hooks/useSlotLabel";
import { adminQueryKeys } from "@/lib/admin/query-keys";
import { useFormatter } from "@/lib/datetime/client";
import { getDivisionLabel, getDivisionOptions } from "@/lib/divisions/grid";
import { findRole, ratedDimension, registrationRoles } from "@/lib/roster/ontology";
import { OPEN_SLOT_CODE } from "@/lib/roster/shape";
import {
  RANK_LAYERS,
  workspacePlayerKeys,
  workspacePlayerService,
  type RankLayer,
  type RankOverviewRow,
} from "@/services/workspace-player.service";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type { DisciplineMetadata } from "@/types/discipline.types";

const PAGE_SIZE = 30;

const LAYER_ICON: Record<RankLayer, LucideIcon> = {
  canon: Building2,
  author: NotebookPen,
  ow: Radar,
  hidden: EyeOff,
  effective_tournament: Trophy,
  effective_mix: Shuffle,
  registration: ClipboardList,
  tournament: Users,
  casual: Gamepad2,
};

/** Dates live outside `useFilters` (the chip bar has no range kind), so they reset the page themselves. */
const DATE_PARAMS = { from: "date_from", to: "date_to" } as const;

/** Signs a delta the way a reader expects: "+120", "-80", "0". */
const signedDelta = (value: number) => (value > 0 ? `+${value}` : String(value));

export interface RankOverviewTableProps {
  /**
   * Pins the table to one person (`players.user` id). The player column and the
   * search box go with it — both only answer "which person", which is settled.
   */
  playerId?: number;
}

/** The role and division filters are one game's: a pick of another game leaves them behind (R5). */
const RANK_GAME_PARAMS = ["role", "div_min", "div_max"];

/**
 * One game's rank values in the workspace — a single page with local game tabs under "all games" until the ranks list
 * spans every game (Task 45). The game's roles, grid and native layer are its own, and an invalid or empty resolution
 * reads nothing. Switching game remounts the table, so no row of the previous game is shown while the next one loads.
 */
export function RankOverviewTable({ playerId }: Readonly<RankOverviewTableProps>) {
  const t = useTranslations("admin.rankOverview");
  const workspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);
  const scope = useGameScope({ pageClass: "single", axis: workspaceId ?? "all" });
  useGameBoundParams(RANK_GAME_PARAMS);
  const discipline = scope.game;
  const metadata = useDisciplineMetadata(scope.axis, discipline);

  if (workspaceId == null) {
    return <EmptyNote>{t("noWorkspace")}</EmptyNote>;
  }
  if (scope.resolution?.game.kind === "invalid" || scope.resolution?.game.kind === "empty") {
    return <GameScopeControl scope={scope} variant="single" dropParams={RANK_GAME_PARAMS} />;
  }
  if (scope.isError || metadata.isError) {
    return (
      <PageStateCard
        state="error"
        title={t("loadError")}
        onAction={() => {
          scope.refetch();
          void metadata.refetch();
        }}
      />
    );
  }
  if (discipline === null || !metadata.data) {
    return <Skeleton className="h-64" />;
  }
  return (
    <div className="space-y-4">
      <GameScopeControl scope={scope} variant="single" dropParams={RANK_GAME_PARAMS} />
      <RankOverviewRows
        key={`${workspaceId}:${discipline}`}
        playerId={playerId}
        workspaceId={workspaceId}
        discipline={discipline}
        ontology={metadata.data}
      />
    </div>
  );
}

/**
 * Every rank value of the game in the workspace, one row per value: canon, each
 * author's book, the native-ladder scrape (for a game that collects one), the
 * hidden rating, both computed effective numbers, and the three historical
 * layers.
 *
 * Read-only on purpose. Editing a rank has two owners already (the roster's
 * rank editor and a person's own panel), and a table that mixes nine layers —
 * three of which are computed and cannot be written at all — is the wrong place
 * to grow a third. Filters, sort and page live in the URL, and `useQueryParams`
 * merges rather than replaces, so the person page's `?tab=ranks` survives.
 */
function RankOverviewRows({
  playerId,
  workspaceId,
  discipline,
  ontology,
}: Readonly<{
  playerId?: number;
  workspaceId: number;
  discipline: string;
  ontology: DisciplineMetadata;
}>) {
  const t = useTranslations("admin.rankOverview");
  const tBracket = useTranslations("adminBracket");
  const slotLabel = useSlotLabel(ontology);
  const format = useFormatter();
  const grid = useDivisionGrid(discipline);
  // Only a game that collects a native rank has that layer, named by the game.
  const nativeRankName = ontology.discipline.capabilities.native_rank_collection ? ontology.discipline.name : null;
  const { searchParams, setParams } = useQueryParams({ resetOnChange: ["page"] });
  const dateFrom = searchParams?.get(DATE_PARAMS.from) ?? "";
  const dateTo = searchParams?.get(DATE_PARAMS.to) ?? "";

  const authorsQuery = useQuery({
    queryKey: workspacePlayerKeys.authors(workspaceId),
    queryFn: () => workspacePlayerService.listAuthors(workspaceId),
    staleTime: 60_000,
  });

  const divisionOptions = useMemo(
    () =>
      getDivisionOptions(grid).map((division) => ({
        value: String(division),
        label: getDivisionLabel(grid, division) ?? tBracket("labels.divisionFallback", { number: division }),
      })),
    [grid, tBracket],
  );

  const defs = useMemo<FilterDef[]>(
    () => [
      {
        key: "layer",
        label: t("filters.layer"),
        kind: "multi",
        options: RANK_LAYERS.filter((layer) => layer !== "ow" || nativeRankName !== null).map((layer) => ({
          value: layer,
          label: t(`layers.${layer}`, { game: nativeRankName ?? "" }),
        })),
      },
      {
        key: "author",
        label: t("filters.author"),
        kind: "multi",
        options: (authorsQuery.data?.authors ?? []).map((author) => ({
          value: String(author.user_id),
          label: author.display_name ?? `#${author.user_id}`,
          count: author.count,
        })),
      },
      {
        key: "role",
        label: t("filters.role"),
        kind: "multi",
        options: registrationRoles(ontology).map((role) => ({ value: role.code, label: slotLabel(role.code) })),
      },
      // A division band IS a rank range, and the workspace grid is the only
      // honest mapping between them — two numeric inputs would ask the operator
      // to remember that Diamond starts at 3500.
      { key: "div_min", label: t("filters.divisionMin"), kind: "single", options: divisionOptions },
      { key: "div_max", label: t("filters.divisionMax"), kind: "single", options: divisionOptions },
      { key: "differs", label: t("filters.differsFromCanon"), kind: "toggle" },
    ],
    [t, slotLabel, ontology, nativeRankName, authorsQuery.data, divisionOptions],
  );

  const filters = useFilters(defs);
  const layerFilter = filters.values.layer as string[];
  const authorFilter = filters.values.author as string[];
  const roleFilter = filters.values.role as string[];
  const differsFilter = filters.values.differs === true;
  const minTier = grid.tiers.find((tier) => String(tier.number) === filters.values.div_min);
  const maxTier = grid.tiers.find((tier) => String(tier.number) === filters.values.div_max);
  const rankMin = minTier?.rank_min;
  // The top tier is open-ended (`rank_max: null`), which is "no ceiling", not 0.
  const rankMax = maxTier?.rank_max ?? undefined;

  const columns = useMemo<ColumnDef<RankOverviewRow>[]>(() => {
    const player: ColumnDef<RankOverviewRow> = {
      id: "display_name",
      header: t("columns.player"),
      meta: columnMeta<RankOverviewRow>({ sticky: true }),
      cell: ({ row }) => (
        <Link
          href={`/admin/people/${row.original.player_id}`}
          className="font-medium text-primary underline-offset-2 hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          {row.original.display_name || row.original.identity?.handle || `#${row.original.player_id}`}
        </Link>
      ),
    };

    const rest: ColumnDef<RankOverviewRow>[] = [
      {
        accessorKey: "layer",
        header: t("columns.layer"),
        cell: ({ row }) => {
          const Icon = LAYER_ICON[row.original.layer];
          return (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs">
              <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              {t(`layers.${row.original.layer}`, { game: ontology.discipline.name })}
            </span>
          );
        },
      },
      {
        id: "author",
        header: t("columns.author"),
        enableSorting: false,
        cell: ({ row }) =>
          row.original.author_name ??
          (row.original.author_user_id == null ? null : `#${row.original.author_user_id}`),
      },
      {
        accessorKey: "role",
        header: t("columns.role"),
        meta: columnMeta<RankOverviewRow>({ align: "center" }),
        cell: ({ row }) => {
          const role = row.original.role;
          if (!role) return null;
          const rated = ratedDimension(ontology);
          const known =
            role === OPEN_SLOT_CODE ||
            (rated !== null && findRole(ontology, { dimension: rated.code, role }) !== null);
          // A role the game's dictionary does not know stays its raw code, never a guessed glyph.
          return known ? (
            <span className="inline-flex">
              <PlayerRoleIcon role={role} ontology={ontology} size={18} />
            </span>
          ) : (
            <span className="text-xs">{role}</span>
          );
        },
      },
      {
        accessorKey: "rank_value",
        header: t("columns.rankValue"),
        meta: columnMeta<RankOverviewRow>({ align: "right", numeric: true }),
        cell: ({ row }) => row.original.rank_value,
      },
      {
        id: "division",
        header: t("columns.division"),
        enableSorting: false,
        cell: ({ row }) => {
          const { division, ow_division: owDivision, ow_tier: owTier } = row.original;
          return (
            <div className="flex items-center gap-2">
              {division == null ? null : (
                <>
                  <DivisionIcon division={division} tournamentGrid={grid} width={20} height={20} />
                  <span className="truncate">
                    {getDivisionLabel(grid, division) ??
                      tBracket("labels.divisionFallback", { number: division })}
                  </span>
                </>
              )}
              {owDivision ? (
                // The native ladder's own naming, kept beside the workspace grid's:
                // the two disagree, and the scrape is only readable as itself.
                <span className="whitespace-nowrap text-xs capitalize text-muted-foreground">
                  {owDivision}
                  {owTier == null ? "" : ` ${owTier}`}
                </span>
              ) : null}
            </div>
          );
        },
      },
      {
        id: "source",
        header: t("columns.source"),
        enableSorting: false,
        cell: ({ row }) => {
          const source = row.original.source;
          if (!source) return null;
          return (
            <span className="text-xs text-muted-foreground">
              {t(`sources.${source}`, { game: ontology.discipline.name })}
            </span>
          );
        },
      },
      {
        accessorKey: "canon_diff",
        header: t("columns.canonDiff"),
        meta: columnMeta<RankOverviewRow>({ align: "right", numeric: true }),
        cell: ({ row }) =>
          row.original.canon_diff == null ? null : signedDelta(row.original.canon_diff),
      },
      {
        accessorKey: "delta",
        header: t("columns.delta"),
        meta: columnMeta<RankOverviewRow>({ align: "right", numeric: true }),
        cell: ({ row }) => (row.original.delta == null ? null : signedDelta(row.original.delta)),
      },
      {
        accessorKey: "sigma",
        header: t("columns.sigma"),
        enableSorting: false,
        meta: columnMeta<RankOverviewRow>({ align: "right", numeric: true }),
        cell: ({ row }) => (row.original.sigma == null ? null : row.original.sigma.toFixed(1)),
      },
      {
        id: "context",
        header: t("columns.context"),
        enableSorting: false,
        cell: ({ row }) => {
          const context = row.original.context;
          if (!context) return null;
          const href =
            context.id == null
              ? null
              : context.kind === "tournament"
                ? `/admin/tournaments/${context.id}`
                : context.kind === "mix"
                  ? `/balancer/mix/${context.id}`
                  : null;
          // On a native-account row `team` is the native platform, not a team name.
          const detail = [
            context.kind === "native_account" ? null : context.team,
            context.lobby_index == null
              ? null
              : // A..F, the same glyph the mix surface gives a lobby. Spelled out
                // rather than imported: `pickup-chrome` is route-zone code (Z2).
                t("lobby", { letter: String.fromCharCode(65 + context.lobby_index) }),
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <div className="flex min-w-0 flex-col">
              {href ? (
                <Link
                  href={href}
                  className="truncate text-primary underline-offset-2 hover:underline"
                  onClick={(event) => event.stopPropagation()}
                >
                  {context.label}
                </Link>
              ) : (
                <span className="truncate">{context.label}</span>
              )}
              {detail ? (
                <span className="truncate text-xs text-muted-foreground">{detail}</span>
              ) : null}
              {context.kind === "native_account" && context.team ? (
                <span className="truncate text-xs text-muted-foreground">
                  {context.team}
                </span>
              ) : null}
            </div>
          );
        },
      },
      {
        accessorKey: "at",
        header: t("columns.at"),
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
            {formatDate(format, row.original.at)}
          </span>
        ),
      },
    ];

    return playerId == null ? [player, ...rest] : rest;
  }, [t, ontology, tBracket, format, grid, playerId]);

  const activeKey = [filters.filterKey, dateFrom, dateTo].filter(Boolean).join("&");

  return (
    <DataTable<RankOverviewRow>
      queryKey={(page, search, pageSize, sortField, sortDir) =>
        adminQueryKeys.rankOverview(workspaceId, {
          discipline,
          playerId,
          page,
          search,
          pageSize,
          sortField,
          sortDir,
          activeKey,
        })
      }
      queryFn={(page, search, pageSize, sortField, sortDir) =>
        workspacePlayerService.listRanks(workspaceId, {
          discipline,
          page,
          perPage: pageSize,
          playerId,
          query: search || undefined,
          layer: layerFilter,
          authorUserId: authorFilter.map(Number),
          role: roleFilter,
          rankMin,
          rankMax,
          differsFromCanon: differsFilter || undefined,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          sort: sortField ?? undefined,
          order: sortDir,
        })
      }
      columns={columns}
      initialPageSize={PAGE_SIZE}
      initialSort={{ field: "display_name", dir: "asc" }}
      filterKey={activeKey}
      getRowId={(row) =>
        [row.layer, row.member_id, row.author_user_id, row.role, row.at, row.context?.id].join(":")
      }
      searchPlaceholder={playerId == null ? t("searchPlaceholder") : undefined}
      toolbar={
        <FilterBar
          defs={defs}
          filters={filters}
          trailing={
            <div className="flex flex-wrap items-center gap-2">
              <div className="w-64">
                <DateRangePicker
                  startDate={dateFrom || undefined}
                  endDate={dateTo || undefined}
                  placeholder={t("filters.dateRange")}
                  onChange={(from, to) =>
                    setParams({ [DATE_PARAMS.from]: from || null, [DATE_PARAMS.to]: to || null })
                  }
                />
              </div>
            </div>
          }
        />
      }
      emptyMessage={activeKey ? t("emptyFiltered") : t("empty")}
    />
  );
}
