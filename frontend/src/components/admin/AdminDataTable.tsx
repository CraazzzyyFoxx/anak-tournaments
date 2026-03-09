"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
  Row
} from "@tanstack/react-table";
import { CircleMinus, Search } from "lucide-react";
import { usePathname } from "next/navigation";
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
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";

export interface AdminDataTableProps<TData> {
  // Data
  initialData?: PaginatedResponse<TData>;
  queryKey: (page: number, search: string) => readonly unknown[];
  queryFn: (page: number, search: string) => Promise<PaginatedResponse<TData>>;

  // Table configuration
  columns: ColumnDef<TData>[];
  searchPlaceholder?: string;
  emptyMessage?: string;

  // Actions
  onRowClick?: (row: Row<TData>) => void;
  actions?: React.ReactNode;

  // URL state
  initialPage?: number;
  initialSearch?: string;
}

export function AdminDataTable<TData>({
  initialData,
  queryKey,
  queryFn,
  columns,
  searchPlaceholder = "Search...",
  emptyMessage = "No results found.",
  onRowClick,
  actions,
  initialPage = 1,
  initialSearch = ""
}: AdminDataTableProps<TData>) {
  const pathname = usePathname();
  const [searchValue, setSearchValue] = useState<string>(initialSearch);
  const [debouncedSearchValue] = useDebounce(searchValue, 300);
  const [currentPage, setCurrentPage] = useState<number>(initialPage);
  const previousDebouncedSearchRef = useRef(initialSearch);
  const previousUrlStateRef = useRef({ page: initialPage, search: initialSearch });

  // Sync search value with initial search
  useEffect(() => {
    setSearchValue(initialSearch);
  }, [initialSearch]);

  // Reset to page 1 when search changes
  useEffect(() => {
    if (previousDebouncedSearchRef.current !== debouncedSearchValue) {
      previousDebouncedSearchRef.current = debouncedSearchValue;
      setCurrentPage(1);
    }
  }, [debouncedSearchValue]);

  // Fetch data
  const dataQuery = useQuery({
    queryKey: queryKey(currentPage, debouncedSearchValue),
    queryFn: () => queryFn(currentPage, debouncedSearchValue),
    placeholderData: (previousData) => previousData,
    initialData:
      initialData && currentPage === initialPage && debouncedSearchValue === initialSearch
        ? initialData
        : undefined
  });

  const data = dataQuery.data ?? initialData ?? { results: [], total: 0, page: 1, per_page: 15 };

  // Handle browser back/forward
  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const nextPage = Number.parseInt(params.get("page") ?? "1", 10) || 1;
      const nextSearch = params.get("search") ?? "";

      previousUrlStateRef.current = { page: nextPage, search: nextSearch };
      setCurrentPage(nextPage);
      setSearchValue(nextSearch);
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  // Update URL when page or search changes
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
      previousUrlStateRef.current = { page: currentPage, search: debouncedSearchValue };
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

    previousUrlStateRef.current = { page: currentPage, search: debouncedSearchValue };
  }, [currentPage, debouncedSearchValue, pathname]);

  const table = useReactTable({
    data: data.results ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    rowCount: data.total ?? 0
  });

  return (
    <div className="flex flex-col gap-4">
      {/* Search and Actions */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            placeholder={searchPlaceholder}
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
          />
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>

      {/* Table */}
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
                    className={onRowClick ? "cursor-pointer" : ""}
                    onClick={() => onRowClick?.(row)}
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
                  <TableCell colSpan={columns.length} className="h-32 text-center">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <CircleMinus className="h-8 w-8 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">{emptyMessage}</p>
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
      {data.total > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {(currentPage - 1) * data.per_page + 1} to{" "}
            {Math.min(currentPage * data.per_page, data.total)} of {data.total} results
          </p>
          <PaginationControlled
            page={currentPage}
            totalCount={data.total}
            pageSize={data.per_page}
            onSetPage={setCurrentPage}
          />
        </div>
      )}
    </div>
  );
}
