"use client";

import React from "react";
import Link from "next/link";
import {
  ColumnDef,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslations } from "next-intl";

import { OwalStanding, OwalStandings } from "@/types/tournament.types";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { columnMeta, DataTable } from "@/components/ui/data-table";
import { Label } from "@/components/ui/label";
import { PageStateCard } from "@/components/ui/page-state-card";
import { PlaceBadge } from "@/components/ui/place-badge";
import { SearchField } from "@/components/ui/search-field";
import DivisionIcon from "@/components/DivisionIcon";
import { getWinrateColor } from "@/utils/colors";

const VIRTUALIZATION_THRESHOLD = 120;

/**
 * Heat colour for a day score. The tiers reuse the shared medal palette, so a
 * workspace theme can restyle them; they used to be four hardcoded hex values.
 */
const dayScoreStyle = (points: number): React.CSSProperties => {
  if (points < 1.71) {
    return { backgroundColor: "var(--aqt-rose)", color: "var(--aqt-bg)" };
  }
  if (points > 5) {
    return { backgroundColor: "var(--aqt-medal-gold)", color: "var(--aqt-medal-gold-fg)" };
  }
  if (points > 4) {
    return { backgroundColor: "var(--aqt-medal-silver)", color: "var(--aqt-medal-silver-fg)" };
  }
  if (points > 3) {
    return { backgroundColor: "var(--aqt-medal-bronze)", color: "var(--aqt-medal-bronze-fg)" };
  }
  return {};
};

const OwalStandingsTable = ({ data }: { data: OwalStandings }) => {
  const t = useTranslations();
  const [sorting, setSorting] = React.useState<SortingState>([{ id: "place", desc: false }]);
  const [globalFilter, setGlobalFilter] = React.useState("");
  const [show3Plus, setShow3Plus] = React.useState(false);
  const parentRef = React.useRef<HTMLDivElement>(null);

  const dayColumns = React.useMemo<ColumnDef<OwalStanding>[]>(
    () =>
      data.days.map((day) => ({
        id: `day_${day.id}`,
        accessorFn: (row) =>
          row.days[day.id.toString()] ? row.days[day.id.toString()].points : "-",
        header: day.name.split(" | ")[1],
        meta: columnMeta<OwalStanding>({ numeric: true }),
        cell: ({ row, getValue }) => {
          const value = getValue<number | string>();
          if (value === "-") return <div>-</div>;

          const dayData = row.original.days[day.id.toString()] as
            | { points?: number; division?: number }
            | undefined;
          const dayDivision = dayData?.division ?? undefined;

          return (
            <div className="flex items-center justify-center gap-2">
              <span>{value as number}</span>
              {typeof dayDivision === "number" && (
                <DivisionIcon division={dayDivision} width={24} height={24} />
              )}
            </div>
          );
        }
      })),
    [data.days]
  );

  const columns = React.useMemo<ColumnDef<OwalStanding>[]>(
    () => [
      {
        accessorKey: "place",
        id: "place",
        accessorFn: (row) => row.place,
        header: t("owal.place"),
        meta: columnMeta<OwalStanding>({ numeric: true }),
        cell: ({ row }) => {
          const place = row.getValue<number>("place");
          return (
            <div className="flex justify-center">
              <PlaceBadge place={place} />
            </div>
          );
        }
      },
      {
        accessorKey: "user.name",
        id: "userName",
        header: t("owal.player"),
        enableSorting: false,
        cell: ({ row }) => {
          const name = row.getValue<string>("userName");
          return (
            <Link href={`/users/${name.replace("#", "-")}`}>{name.split("#")[0]}</Link>
          );
        }
      },
      {
        accessorKey: "role",
        id: "role",
        header: t("owal.role"),
        enableSorting: false,
        cell: ({ row }) => row.getValue<string>("role")
      },
      {
        accessorKey: "division",
        id: "division",
        header: t("owal.division"),
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex justify-center">
            <DivisionIcon division={row.getValue<number>("division")} width={32} height={32} />
          </div>
        )
      },
      ...dayColumns,
      {
        accessorKey: "count_days",
        id: "count_days",
        header: t("owal.played"),
        meta: columnMeta<OwalStanding>({ numeric: true }),
        cell: ({ row }) => row.getValue<number>("count_days")
      },
      {
        accessorKey: "best_3_days",
        id: "best_3_days",
        header: t("owal.totalBest3"),
        meta: columnMeta<OwalStanding>({
          numeric: true,
          cellClassName: "bg-[color:var(--aqt-overlay-2)]"
        }),
        cell: ({ row }) => row.getValue<number>("best_3_days").toFixed(3)
      },
      {
        accessorKey: "avg_points",
        id: "avg_points",
        header: t("owal.average"),
        meta: columnMeta<OwalStanding>({ numeric: true }),
        cell: ({ row }) => row.getValue<number>("avg_points").toFixed(3)
      },
      {
        accessorKey: "wins",
        id: "wins",
        header: t("owal.wins"),
        meta: columnMeta<OwalStanding>({
          numeric: true,
          cellClassName: "text-[color:var(--aqt-emerald)]"
        }),
        cell: ({ row }) => row.getValue<number>("wins")
      },
      {
        accessorKey: "losses",
        id: "losses",
        header: t("owal.losses"),
        meta: columnMeta<OwalStanding>({
          numeric: true,
          cellClassName: "text-[color:var(--aqt-rose)]"
        }),
        cell: ({ row }) => row.getValue<number>("losses")
      },
      {
        accessorKey: "draws",
        id: "draws",
        header: t("owal.draws"),
        meta: columnMeta<OwalStanding>({
          numeric: true,
          cellClassName: "text-[color:var(--aqt-fg-dim)]"
        }),
        cell: ({ row }) => row.getValue<number>("draws")
      },
      {
        accessorKey: "win_rate",
        id: "win_rate",
        header: t("owal.winRatio"),
        meta: columnMeta<OwalStanding>({ numeric: true }),
        cell: ({ row }) => {
          const winrate = row.getValue<number>("win_rate");
          return (
            <span style={{ color: getWinrateColor(winrate) }}>{(winrate * 100).toFixed(2)}%</span>
          );
        }
      }
    ],
    [dayColumns, t]
  );

  const standingsData = React.useMemo(
    () => (show3Plus ? data.standings.filter((s) => s.count_days >= 3) : data.standings),
    [show3Plus, data.standings]
  );

  const table = useReactTable({
    data: standingsData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    rowCount: standingsData.length,
    onSortingChange: setSorting,
    state: { sorting, globalFilter },
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: (row, _columnId, filterValue) =>
      row.getValue<string>("userName").toLowerCase().includes(String(filterValue).toLowerCase())
  });

  const rows = table.getRowModel().rows;
  const shouldVirtualize = rows.length > VIRTUALIZATION_THRESHOLD;

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48,
    overscan: 10
  });

  const virtualItems = shouldVirtualize ? rowVirtualizer.getVirtualItems() : [];
  const totalSize = shouldVirtualize ? rowVirtualizer.getTotalSize() : 0;
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom =
    virtualItems.length > 0 ? totalSize - virtualItems[virtualItems.length - 1].end : 0;

  const filtersActive = globalFilter.trim() !== "" || show3Plus;

  const clearFilters = () => {
    setGlobalFilter("");
    setShow3Plus(false);
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center gap-4">
        <SearchField
          value={globalFilter}
          onValueChange={setGlobalFilter}
          label={t("owal.searchUser")}
          placeholder={t("owal.searchUser")}
          containerClassName="w-full sm:w-[300px] md:w-[200px] lg:w-[300px]"
        />

        <div className="flex items-center gap-2">
          <Checkbox
            id="owal-only-3-plus"
            checked={show3Plus}
            onCheckedChange={(value) => setShow3Plus(value === true)}
          />
          <Label htmlFor="owal-only-3-plus">{t("owal.only3Days")}</Label>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <DataTable
            table={table}
            label={t("owal.standingsTableLabel")}
            align="center"
            scrollRef={parentRef}
            scrollClassName="max-h-[70vh]"
            virtualRows={
              shouldVirtualize ? virtualItems.map((item) => rows[item.index]) : undefined
            }
            paddingTop={shouldVirtualize ? paddingTop : 0}
            paddingBottom={shouldVirtualize ? paddingBottom : 0}
            cellStyle={(cell) => {
              if (!cell.column.id.startsWith("day_")) return undefined;
              const value = cell.getValue();
              return typeof value === "number" ? dayScoreStyle(value) : undefined;
            }}
            emptyState={
              <PageStateCard
                state={filtersActive ? "filtered-empty" : "empty"}
                onAction={filtersActive ? clearFilters : undefined}
                className="border-0"
              />
            }
          />
        </CardContent>
      </Card>
    </div>
  );
};

export default OwalStandingsTable;
