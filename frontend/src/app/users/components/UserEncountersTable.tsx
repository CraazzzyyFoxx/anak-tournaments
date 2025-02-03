"use client";

import React from "react";
import { ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { CircleMinus, CirclePlus } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { EncounterWithUserStats, MatchWithUserStats } from "@/types/user.types";
import { useRouter } from "next/navigation";
import { PaginationWithLinks } from "@/components/ui/pagination-with-links";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { PerformanceBadgeWithTooltip } from "@/components/PerformanceBagde";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PaginatedResponse } from "@/types/pagination.types";
import Image from "next/image";
import { Card } from "@/components/ui/card";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Score } from "@/types/encounter.types";
import { Tournament, TournamentGroup } from "@/types/tournament.types";

const columns: ColumnDef<EncounterWithUserStats>[] = [
  {
    accessorKey: "tournament",
    header: "Tournament",
    cell: ({ row }) => {
      let name = `Tournament ${row.getValue<Tournament>("tournament").number}`;
      if (row.getValue<Tournament>("tournament").is_league) {
        name = row.getValue<Tournament>("tournament").name;
      }

      return <div className="capitalize">{name}</div>;
    }
  },
  {
    accessorKey: "tournament_group",
    header: "Group",
    cell: ({ row }) => <div>{row.getValue<TournamentGroup>("tournament_group").name}</div>
  },
  {
    accessorKey: "name",
    header: () => <div>Name</div>,
    cell: ({ row }) => {
      return <div className="font-medium">{row.getValue("name")}</div>;
    }
  },
  {
    accessorKey: "score",
    header: () => <div>Score</div>,
    cell: ({ row }) => (
      <div>
        {row.getValue<Score>("score").home}-{row.getValue<Score>("score").away}
      </div>
    )
  },
  {
    id: "heroes",
    accessorKey: "matches",
    header: "Heroes",
    cell: ({ row }) => {
      const heroes: string[] = [];

      row.getValue<MatchWithUserStats[]>("heroes").forEach((match) => {
        match.heroes.forEach((hero) => {
          if (!heroes.includes(hero.image_path)) {
            heroes.push(hero.image_path);
          }
        });
      });

      return (
        <div className="flex flex-row gap-2">
          {heroes.map((hero) => {
            return (
              <Avatar key={`hero-${hero}`}>
                <AvatarImage src={hero} asChild>
                  <Image src={hero} alt="Hero" width={128} height={128} />
                </AvatarImage>
                <AvatarFallback> </AvatarFallback>
              </Avatar>
            );
          })}
        </div>
      );
    }
  },
  {
    id: "mvp",
    accessorKey: "matches",
    header: "MVP Status",
    cell: ({ row }) => {
      return (
        <div className="flex flex-row gap-2">
          {row.getValue<MatchWithUserStats[]>("mvp").map((match) => {
            return (
              <PerformanceBadgeWithTooltip
                key={`performance-${row.getValue("id")}-${match.id}`}
                match={match}
              />
            );
          })}
        </div>
      );
    }
  },
  {
    accessorKey: "closeness",
    header: () => <div className="text-center">Percentage of closeness</div>,
    cell: ({ row }) => {
      const closeness = row.getValue<number>("closeness")
        ? `${(row.getValue<number>("closeness") * 100).toFixed(0)}%`
        : "-";
      return <div className="text-center">{closeness}</div>;
    }
  },
  {
    accessorKey: "has_logs",
    header: () => <div className="text-center">Has logs</div>,
    cell: ({ row }) => (
      <div className="flex justify-center">
        {row.getValue("has_logs") ? (
          <CirclePlus className="text-green-500" />
        ) : (
          <CircleMinus className="text-red-500" />
        )}
      </div>
    )
  }
];

const UserEncountersTable = ({
  encounters,
  InitialPage
}: {
  encounters: PaginatedResponse<EncounterWithUserStats>;
  InitialPage: number;
}) => {
  const router = useRouter();
  const table = useReactTable({
    data: encounters.results,
    columns,
    getCoreRowModel: getCoreRowModel(),
    rowCount: encounters.total,
    manualPagination: true
  });

  return (
    <>
      <ScrollArea>
        <Card className="w-full">
          <TooltipProvider>
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
                      key={row.original.id}
                      data-state={row.getIsSelected() && "selected"}
                      onClick={() => {
                        router.push(`/encounters/${row.original.id}`);
                      }}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id}>
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
          </TooltipProvider>
        </Card>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
      <div className="flex items-center justify-end space-x-2 py-4">
        <PaginationWithLinks totalCount={encounters.total} pageSize={10} page={InitialPage} />
      </div>
    </>
  );
};

export default UserEncountersTable;
