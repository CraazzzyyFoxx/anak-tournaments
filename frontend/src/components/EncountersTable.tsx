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
            // @ts-ignore
            let name = `Tournament ${row.getValue("tournament").number}`;
            // @ts-ignore
            if (row.getValue("tournament").is_league) {
              // @ts-ignore
              name = row.getValue("tournament").name;
            }

            return <div className="capitalize">{name}</div>;
          }
        }
      ];
    }
    columns = [
      ...columns,
      {
        accessorKey: "tournament_group",
        header: "Group",
        // @ts-ignore
        cell: ({ row }) => <div>{row.getValue("tournament_group").name}</div>
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
        header: "Score",
        cell: ({ row }) => {
          const score: Score = row.getValue("score");
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
          // @ts-ignore
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
      </div>
      <div className="flex items-center justify-end space-x-2 py-4">
        <PaginationWithLinks page={InitialPage} totalCount={data.total} pageSize={15} />
      </div>
    </div>
  );
};

export default EncountersTable;
