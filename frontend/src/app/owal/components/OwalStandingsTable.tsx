"use client";

import React from "react";
import { OwalStanding, OwalStandings } from "@/types/tournament.types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  PaginationState,
  SortingState,
  useReactTable
} from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { getWinrateColor } from "@/utils/colors";
import { Button } from "@/components/ui/button";
import { ArrowUpDown } from "lucide-react";
import { PaginationControlled } from "@/components/ui/pagination-with-links";
import { CardContent, Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const getDayColor = (points: number) => {
  let color = {};
  if (points < 1.71) {
    color = { backgroundColor: "#f56565", color: "#121009" };
  }
  if (points > 3) {
    color = { backgroundColor: "#a86243" };
    if (points > 4) {
      color = { backgroundColor: "#99b0cc", color: "#121009" };
    }
    if (points > 5) {
      color = { backgroundColor: "#cbb765", color: "#121009" };
    }
  }
  return color;
};

const OwalStandingsTable = ({ data }: { data: OwalStandings }) => {
  const router = useRouter();
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = React.useState("");
  const [pagination, setPagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize: 15
  });

  const days_columns: ColumnDef<OwalStanding>[] = data.days.map((day) => ({
    accessorFn: (row) => (row.days[day.id.toString()] ? row.days[day.id.toString()].points : "-"),
    header: day.name.split(" | ")[1],
    id: `day_${day.id}`
  }));

  const columns: ColumnDef<OwalStanding>[] = [
    {
      accessorKey: "place",
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Place
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
      id: "place",
      accessorFn: (row) => row.place
    },
    {
      accessorKey: "user.name",
      id: "userName",
      header: "Player",
      cell: ({ row }) => {
        return (
          // @ts-ignore
          <div className="text-right">{row.getValue("userName").split("#")[0]}</div>
        );
      }
    },
    {
      accessorKey: "role",
      id: "role",
      header: "Role",
      cell: ({ row }) => {
        return (
          // @ts-ignore
          <div className="text-right">{row.getValue("role")}</div>
        );
      }
    },
    ...days_columns,
    {
      accessorKey: "count_days",
      header: "Days Played",
      id: "count_days",
      cell: ({ row }) => <div>{row.getValue("count_days")}</div>
    },
    {
      accessorKey: "best_3_days",
      id: "best_3_days",
      header: "TOTAL (best 3 days)",
      cell: ({ row }) => {
        // @ts-ignore
        return <div>{row.getValue("best_3_days").toFixed(2)}</div>;
      }
    },
    {
      accessorKey: "avg_points",
      header: "Average",
      id: "avg_points",
      cell: ({ row }) => {
        // @ts-ignore
        return <div>{row.getValue("avg_points").toFixed(2)}</div>;
      }
    },
    {
      accessorKey: "wins",
      header: "W",
      id: "wins",
      cell: ({ row }) => {
        return <div className="text-green-400">{row.getValue("wins")}</div>;
      }
    },
    {
      accessorKey: "losses",
      header: "L",
      id: "losses",
      cell: ({ row }) => {
        return <div className="text-red-400">{row.getValue("losses")}</div>;
      }
    },
    {
      accessorKey: "draws",
      header: "D",
      id: "draws",
      cell: ({ row }) => {
        return <div className="text-gray-400">{row.getValue("draws")}</div>;
      }
    },
    {
      accessorKey: "win_rate",
      id: "win_rate",
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Winrate
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
      cell: ({ row }) => {
        // @ts-ignore
        const winrate: number = row.getValue("win_rate");
        return <div style={{ color: getWinrateColor(winrate) }}>{(winrate * 100).toFixed(2)}%</div>;
      }
    }
  ];

  const table = useReactTable({
    data: data.standings,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    rowCount: data.standings.length,
    onSortingChange: setSorting,
    state: {
      sorting,
      pagination,
      globalFilter
    },
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: (row, columnId, filterValue) => {
      // @ts-ignore
      return row.getValue("userName").toLowerCase().includes(filterValue.toLowerCase());
    }
  });

  return (
    <div className="flex flex-col gap-8">
      <div className="sm:w-[300px] md:w-[200px] lg:w-[300px]">
        <Input
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          placeholder="Search..."
        />
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    return (
                      <TableHead className="text-center" key={header.id}>
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows?.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() && "selected"}
                    onClick={() => {
                      // @ts-ignore
                      router.push(`/users/${row.getValue("userName").replace("#", "-")}`);
                    }}
                  >
                    {row.getVisibleCells().map((cell) => {
                      // @ts-ignore
                      if (
                        cell.column.columnDef.header &&
                        cell.column?.columnDef?.id?.startsWith("day") &&
                        cell.column.columnDef.id !== "place"
                      ) {
                        return (
                          // @ts-ignore
                          <TableCell
                            key={cell.id}
                            className="text-center"
                            style={getDayColor(cell?.getValue() as number)}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </TableCell>
                        );
                      }
                      // @ts-ignore
                      if (
                        cell.column.columnDef.header &&
                        cell.column.columnDef.id == "best_3_days"
                      ) {
                        return (
                          <TableCell key={cell.id} className="text-center bg-gray-800">
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </TableCell>
                        );
                      }
                      return (
                        <TableCell className="text-center" key={cell.id}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={columns.length} className="h-24 text-center">
                    No results.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <PaginationControlled
        totalCount={data.standings.length}
        pageSize={pagination.pageSize}
        page={pagination.pageIndex + 1}
        onSetPage={(newPage) => {
          table.setPageIndex(newPage);
          setPagination((prev) => ({ ...prev, pageIndex: newPage - 1 }));
        }}
      />
    </div>
  );
};

export default OwalStandingsTable;
