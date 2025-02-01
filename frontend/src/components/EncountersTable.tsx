"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { Encounter, Score } from "@/types/encounter.types";
import { CircleMinus, CirclePlus } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useDebounce } from "use-debounce";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { PaginationWithLinks } from "@/components/ui/pagination-with-links";
import { PaginatedResponse } from "@/types/pagination.types";
import { Tournament, TournamentGroup } from "@/types/tournament.types";
import { ScrollArea, ScrollBar } from "./ui/scroll-area";

const EncountersTable = ({
  data,
  InitialPage,
  search,
  hideTournament
}: {
  data: PaginatedResponse<Encounter>;
  InitialPage: number;
  search: string;
  hideTournament?: boolean;
}) => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [searchValue, setSearchValue] = useState<string>(search);
  const [debouncedSearchValue] = useDebounce(searchValue, 300);

  const columns: ColumnDef<Encounter>[] = useMemo(() => {
    let columns: ColumnDef<Encounter>[] = [];
    if (!hideTournament) {
      columns = [
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
        }
      ];
    }
    columns = [
      {
        accessorKey: "name",
        header: () => <div>Name</div>,
        cell: ({ row }) => {
          return <div className="font-medium">{row.getValue("name")}</div>;
        }
      },
      ...columns,
      {
        accessorKey: "tournament_group",
        header: "Group",
        cell: ({ row }) => <div>{row.getValue<TournamentGroup>("tournament_group").name}</div>
      },
      {
        accessorKey: "round",
        header: "Round",
        cell: ({ row }) => <div>{row.getValue("round")}</div>
      },
  
      {
        accessorKey: "score",
        header: "Score",
        cell: ({ row }) => {
          const score = row.getValue<Score>("score");
          return (
            <div>
              {score.home}-{score.away}
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
    return columns;
  }, [hideTournament]);

  useEffect(() => {
    setSearchValue(debouncedSearchValue);
    router.push(pathname + "?" + createQueryString("search", debouncedSearchValue));
  }, [debouncedSearchValue]);

  const createQueryString = useCallback(
    (name: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set(name, value);
      return params.toString();
    },
    [searchParams]
  );

  const table = useReactTable({
    data: data.results ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    rowCount: data.total ?? 0
  });

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Input
          className="sm:w-[300px] md:w-[200px] lg:w-[300px]"
          placeholder="Search by name"
          value={searchValue}
          onChange={(event) => setSearchValue(event.target.value)}
        />
      </div>
      <div className="rounded-md border">
        <ScrollArea>
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
        <ScrollBar orientation="horizontal"/>
        </ScrollArea>
      </div>
      <div className="flex items-center justify-end space-x-2 py-4">
        <PaginationWithLinks page={InitialPage} totalCount={data.total} pageSize={15} />
      </div>
    </div>
  );
};

export default EncountersTable;
