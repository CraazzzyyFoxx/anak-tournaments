"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
  Row
} from "@tanstack/react-table";
import { CircleMinus, LoaderCircle, Search, SlidersHorizontal } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const ADMIN_ACTION_COLUMN_ID = "actions";
const ADMIN_ACTION_COLUMN_MIN_WIDTH = 112;

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
  const isRefreshing = dataQuery.isFetching && !dataQuery.isLoading;
  const rangeStart = data.total > 0 ? (currentPage - 1) * data.per_page + 1 : 0;
  const rangeEnd = data.total > 0 ? Math.min(currentPage * data.per_page, data.total) : 0;

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

  const getColumnStyle = (column: { id: string; getSize: () => number; columnDef: { size?: number } }) => {
    const configuredSize = typeof column.columnDef.size === "number" ? column.getSize() : undefined;
    const width =
      column.id === ADMIN_ACTION_COLUMN_ID
        ? Math.max(configuredSize ?? 0, ADMIN_ACTION_COLUMN_MIN_WIDTH)
        : configuredSize;

    return width ? { width, minWidth: width } : undefined;
  };

  const handleRowClick = (event: React.MouseEvent<HTMLTableRowElement>, row: Row<TData>) => {
    if (!onRowClick) {
      return;
    }

    const target = event.target as HTMLElement;
    const interactiveElement = target.closest(
      "button, a, input, select, textarea, [role='button'], [role='link'], [data-radix-collection-item]"
    );

    if (interactiveElement) {
      return;
    }

    onRowClick(row);
  };

  const handleRowKeyDown = (event: React.KeyboardEvent<HTMLTableRowElement>, row: Row<TData>) => {
    if (!onRowClick) {
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onRowClick(row);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-border/70 bg-card/70 p-3 shadow-sm sm:p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Dataset Controls
            </div>
            <p className="text-sm text-muted-foreground">
              {data.total > 0
                ? `Showing ${rangeStart}-${rangeEnd} of ${data.total} records`
                : "No records loaded yet"}
            </p>
          </div>

          <div className="flex w-full flex-col gap-3 sm:flex-row lg:w-auto lg:min-w-[420px] lg:justify-end">
            <div className="relative w-full lg:max-w-sm">
              <Label htmlFor="admin-table-search" className="sr-only">
                {searchPlaceholder}
              </Label>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="admin-table-search"
                aria-label={searchPlaceholder}
                autoComplete="off"
                className="border-border/70 bg-background/80 pl-9"
                name="admin-table-search"
                placeholder={searchPlaceholder}
                value={searchValue}
                onChange={(event) => setSearchValue(event.target.value)}
              />
            </div>
            {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card/70 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-gradient-to-r from-muted/35 via-muted/20 to-background/20 px-4 py-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            {isRefreshing ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
            <span>{isRefreshing ? "Refreshing data" : "Snapshot ready"}</span>
          </div>
          <span>{searchValue ? `Filtered by “${searchValue}”` : "Showing full dataset"}</span>
        </div>

        <ScrollArea>
          <Table className="min-w-full border-separate border-spacing-0">
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id} className="border-border/60 hover:bg-transparent">
                  {headerGroup.headers.map((header, index) => {
                    const isActionColumn = header.column.id === ADMIN_ACTION_COLUMN_ID;
                    const isFirstColumn = index === 0;
                    const isLastColumn = index === headerGroup.headers.length - 1;

                    return (
                      <TableHead
                        key={header.id}
                        className={cn(
                          "h-11 border-b border-border/60 bg-muted/15 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/90",
                          isFirstColumn && "pl-4 sm:pl-5",
                          isLastColumn && "pr-4 sm:pr-5",
                          isActionColumn ? "text-right" : "text-left"
                        )}
                        style={getColumnStyle(header.column)}
                      >
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
                    className={cn(
                      "group border-border/50 bg-background/0 transition-colors duration-200 hover:bg-muted/20 data-[state=selected]:bg-muted/25",
                      onRowClick &&
                        "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2"
                    )}
                    onClick={(event) => handleRowClick(event, row)}
                    onKeyDown={(event) => handleRowKeyDown(event, row)}
                    tabIndex={onRowClick ? 0 : undefined}
                  >
                    {row.getVisibleCells().map((cell, index) => {
                      const isActionColumn = cell.column.id === ADMIN_ACTION_COLUMN_ID;
                      const isFirstColumn = index === 0;
                      const isLastColumn = index === row.getVisibleCells().length - 1;

                      return (
                        <TableCell
                          key={cell.id}
                          className={cn(
                            "py-3.5 align-middle",
                            isFirstColumn && "pl-4 sm:pl-5",
                            isLastColumn && "pr-4 sm:pr-5",
                            isActionColumn && "whitespace-nowrap text-right"
                          )}
                          style={getColumnStyle(cell.column)}
                        >
                          {isActionColumn ? (
                            <div className="flex w-full items-center justify-end">
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </div>
                          ) : (
                            flexRender(cell.column.columnDef.cell, cell.getContext())
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={columns.length} className="h-40 text-center">
                    <div className="flex flex-col items-center justify-center gap-3 px-4">
                      <div className="rounded-full border border-border/70 bg-background/70 p-3">
                        <CircleMinus className="h-8 w-8 text-muted-foreground" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-foreground">{emptyMessage}</p>
                        <p className="text-xs text-muted-foreground">
                          {searchValue
                            ? "Try a broader search or clear the current filter."
                            : "Add data or adjust your current admin context to continue."}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </div>

      {data.total > 0 && (
        <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-card/70 px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {rangeStart} to {rangeEnd} of {data.total} results
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
