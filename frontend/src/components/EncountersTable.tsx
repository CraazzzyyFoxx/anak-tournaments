"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { Encounter, Score } from "@/types/encounter.types";
import { CircleMinus, CirclePlus, Search } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useDebounce } from "use-debounce";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { PaginationControlled } from "@/components/ui/pagination-with-links";
import { PaginatedResponse } from "@/types/pagination.types";
import { Tournament } from "@/types/tournament.types";
import { ScrollArea, ScrollBar } from "./ui/scroll-area";
import { useQuery } from "@tanstack/react-query";
import encounterService from "@/services/encounter.service";

const getStageLabel = (encounter: Encounter) =>
  encounter.stage_item?.name ?? encounter.stage?.name ?? "Unassigned";

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
  const [searchValue, setSearchValue] = useState<string>(search);
  const [debouncedSearchValue] = useDebounce(searchValue, 300);
  const [currentPage, setCurrentPage] = useState<number>(InitialPage);
  const previousDebouncedSearchRef = useRef(search);
  const previousUrlStateRef = useRef({ page: InitialPage, search });

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
          return <div className="font-medium text-white/90">{row.getValue("name")}</div>;
        }
      },
      ...columns,
      {
        accessorKey: "stage",
        header: "Stage",
        cell: ({ row }) => <div className="text-white/55">{getStageLabel(row.original)}</div>
      },
      {
        accessorKey: "round",
        header: "Round",
        cell: ({ row }) => <div className="text-white/55">{row.getValue("round")}</div>
      },

      {
        accessorKey: "score",
        header: "Score",
        cell: ({ row }) => {
          const score = row.getValue<Score>("score");
          return (
            <div className="font-semibold tabular-nums text-white/85">
              {score.home}–{score.away}
            </div>
          );
        }
      },
      {
        accessorKey: "closeness",
        header: () => <div className="text-center">Closeness</div>,
        cell: ({ row }) => {
          const closeness = row.getValue<number>("closeness")
            ? `${(row.getValue<number>("closeness") * 100).toFixed(0)}%`
            : "—";
          return <div className="text-center tabular-nums text-white/50">{closeness}</div>;
        }
      },
      {
        accessorKey: "has_logs",
        header: () => <div className="text-center">Logs</div>,
        cell: ({ row }) => (
          <div className="flex justify-center">
            {row.getValue("has_logs") ? (
              <CirclePlus className="h-4 w-4 text-emerald-400" />
            ) : (
              <CircleMinus className="h-4 w-4 text-white/25" />
            )}
          </div>
        )
      }
    ];
    return columns;
  }, [hideTournament]);

  useEffect(() => {
    setSearchValue(search);
  }, [search]);

  useEffect(() => {
    if (previousDebouncedSearchRef.current !== debouncedSearchValue) {
      previousDebouncedSearchRef.current = debouncedSearchValue;
      setCurrentPage(1);
    }
  }, [debouncedSearchValue]);

  const encountersQuery = useQuery({
    queryKey: ["encounters", currentPage, debouncedSearchValue],
    queryFn: () => encounterService.getAll(currentPage, debouncedSearchValue),
    placeholderData: (previousData) => previousData,
    initialData:
      currentPage === InitialPage && debouncedSearchValue === search
        ? data
        : undefined
  });

  const encounters = encountersQuery.data ?? data;

  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const nextPage = Number.parseInt(params.get("page") ?? "1", 10) || 1;

      previousUrlStateRef.current = {
        page: nextPage,
        search: debouncedSearchValue
      };
      setCurrentPage(nextPage);
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [debouncedSearchValue]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const currentSearch = params.get("search") ?? "";
    const currentPageParam = Number.parseInt(params.get("page") ?? "1", 10) || 1;

    const previousUrlState = previousUrlStateRef.current;
    const searchChanged = previousUrlState.search !== debouncedSearchValue;
    const pageChanged = previousUrlState.page !== currentPage;

    if (!searchChanged && !pageChanged) {
      return;
    }

    if (currentSearch === debouncedSearchValue && currentPageParam === currentPage) {
      previousUrlStateRef.current = {
        page: currentPage,
        search: debouncedSearchValue
      };
      return;
    }

    if (debouncedSearchValue) {
      params.set("search", debouncedSearchValue);
    } else {
      params.delete("search");
    }

    if (currentPage > 1) {
      params.set("page", String(currentPage));
    } else {
      params.delete("page");
    }

    const query = params.toString();
    const nextUrl = query ? `${pathname}?${query}` : pathname;

    if (searchChanged) {
      window.history.replaceState(null, "", nextUrl);
    } else {
      window.history.pushState(null, "", nextUrl);
    }

    previousUrlStateRef.current = {
      page: currentPage,
      search: debouncedSearchValue
    };
  }, [currentPage, debouncedSearchValue, pathname]);

  const table = useReactTable({
    data: encounters.results ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    rowCount: encounters.total ?? 0
  });

  return (
    <div className="flex flex-col gap-4">
      {/* Search */}
      <div className="relative sm:w-[300px] md:w-[220px] lg:w-[300px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/30 pointer-events-none" />
        <input
          className="h-9 w-full rounded-lg border border-white/[0.07] bg-white/[0.02] pl-9 pr-3 text-sm text-white placeholder:text-white/25 transition-colors focus:outline-none focus:border-white/[0.18] focus:bg-white/[0.04]"
          placeholder="Search by name"
          value={searchValue}
          onChange={(event) => setSearchValue(event.target.value)}
        />
      </div>

      {/* Table */}
      <div className="rounded-xl border border-white/[0.07] overflow-hidden">
        <ScrollArea>
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id} className="border-white/[0.06] hover:bg-transparent">
                  {headerGroup.headers.map((header) => {
                    return (
                      <TableHead key={header.id} className="h-8 text-[10px] uppercase tracking-wide text-white/35 font-semibold">
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
                    className="border-white/[0.04] hover:bg-white/[0.03] cursor-pointer transition-colors"
                    onClick={() => {
                      router.push(`/encounters/${row.original.id}`);
                    }}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className="py-3">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={columns.length} className="h-32 text-center">
                    <div className="flex flex-col flex-1 items-center justify-center gap-2">
                      <CircleMinus className="h-8 w-8 text-white/20" />
                      <p className="text-sm text-white/35">No encounters found.</p>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-end">
        <PaginationControlled
          page={currentPage}
          totalCount={encounters.total ?? 0}
          pageSize={15}
          onSetPage={setCurrentPage}
        />
      </div>
    </div>
  );
};

export default EncountersTable;
