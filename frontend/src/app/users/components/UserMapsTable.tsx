"use client";

import React from "react";
import {
  ColumnDef,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  PaginationState,
  SortingState,
  useReactTable
} from "@tanstack/react-table";
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
import { HeroPlaytime } from "@/types/hero.types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import TableComponent from "@/components/TableComponent";

const columns: ColumnDef<UserMapRead>[] = [
  {
    accessorKey: "map",
    header: "Map name",
    cell: ({ row }) => {
      const map: MapRead = row.getValue("map");
      return (
        <div className="relative h-[55px] min-w-[300px]">
          <div className="absolute inset-0 z-[1] bg-gradient-to-r from-transparent from-0% via-transparent to-card to-75%" />
          <Image
            className="h-full w-full min-w-[300px] brightness-75 z-0 relative"
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
    accessorKey: "heroes",
    maxSize: 2,
    enableResizing: false,
    header: () => <div className="flex justify-self-end min-w-64">Heroes</div>,
    cell: ({ row }) => (
      <div className="flex justify-self-end">
        <div className="flex gap-2 justify-self-start min-w-64">
          {row.getValue<HeroPlaytime[]>("heroes").map((hero) => {
            return (
              <Avatar key={`hero-${hero}`}>
                <AvatarImage src={hero.hero.image_path} asChild>
                  <Image src={hero.hero.image_path} alt="Hero" width={128} height={128} />
                </AvatarImage>
                <AvatarFallback> </AvatarFallback>
              </Avatar>
            );
          })}
        </div>
      </div>
    )
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
            <TableComponent table={table} columns={columns} tableCellClassName={"p-0"} />
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
