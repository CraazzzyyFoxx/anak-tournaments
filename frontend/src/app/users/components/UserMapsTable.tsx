"use client";

import React from "react";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  PaginationState,
  SortingState,
  useReactTable
} from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { PaginationControlled } from "@/components/ui/pagination-with-links";
import { UserMapRead } from "@/types/user.types";
import { MapRead } from "@/types/map.types";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { ArrowUpDown } from "lucide-react";
import { getWinrateColor } from "@/utils/colors";
import { TypographyH4 } from "@/components/ui/typography";
import { PaginatedResponse } from "@/types/pagination.types";
import { Card } from "@/components/ui/card";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

const columns: ColumnDef<UserMapRead>[] = [
  {
    accessorKey: "map",
    header: "Map name",
    cell: ({ row }) => {
      const map: MapRead = row.getValue("map");
      return (
        <div className="relative h-[55px] min-w-[150px]">
          <div className="absolute inset-0 z-[1] bg-gradient-to-r from-transparent from-0% via-transparent to-card to-75%" />
          <Image
            className="h-full w-full min-w-[150px] brightness-75 z-0 relative"
            src={map.image_path}
            alt={map.name}
            style={{ objectFit: "cover" }}
            fill={true}
          />
          <h4 className="absolute bottom-0 left-0 m-2 text-xl p-1 font-semibold text-white">
            {map.name}
          </h4>
        </div>
      );
    }
  },
  {
    accessorKey: "win_rate",
    header: ({ column }) => {
      return (
        <div className="flex justify-center">
          <Button
            className="p-0 px-2"
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Win rate
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        </div>
      );
    },
    cell: ({ row }) => {
      // @ts-ignore
      const winRate = (row.getValue("win_rate") * 100).toFixed(0);
      return (
        <div
          className="flex justify-center"
          style={{ color: getWinrateColor(row.getValue("win_rate")) }}
        >
          <TypographyH4>{winRate}%</TypographyH4>
        </div>
      );
    }
  },
  {
    accessorKey: "win",
    header: () => <div className="flex justify-center">Wins</div>,
    cell: ({ row }) => (
      <div className="flex justify-center text-green-400">
        <TypographyH4>{row.getValue("win")}</TypographyH4>
      </div>
    )
  },
  {
    accessorKey: "loss",
    header: () => <div className="flex justify-center">Losses</div>,
    cell: ({ row }) => {
      return (
        <div className="flex justify-center text-red-400">
          <TypographyH4>{row.getValue("loss")}</TypographyH4>
        </div>
      );
    }
  },
  {
    accessorKey: "draw",
    header: () => <div className="flex justify-center">Draws</div>,
    cell: ({ row }) => {
      return (
        <div className="flex justify-center text-gray-400">
          <TypographyH4>{row.getValue("draw")}</TypographyH4>
        </div>
      );
    }
  }
];

const UserMapsTable = ({ maps }: { maps: PaginatedResponse<UserMapRead> }) => {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [pagination, setPagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize: 9
  });

  const table = useReactTable({
    data: maps.results,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    rowCount: maps.total,
    onSortingChange: setSorting,
    state: {
      sorting,
      pagination
    }
  });

  const setTablePage = (newPage: number) => {
    table.setPageIndex(newPage);
    setPagination((prev) => ({ ...prev, pageIndex: newPage - 1 }));
  };

  return (
    <>
      <ScrollArea>
        <Card className="w-full">
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => {
                      return (
                        <TableHead key={header.id}>
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
                      className="hover:bg-card data-[state=selected]:bg-card"
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell className="p-0" key={cell.id}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
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
          </div>
        </Card>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
      <div className="flex items-center justify-end space-x-2 py-4">
        <PaginationControlled
          totalCount={maps.total}
          pageSize={9}
          page={pagination.pageIndex + 1}
          onSetPage={setTablePage}
        />
      </div>
    </>
  );
};

export default UserMapsTable;
