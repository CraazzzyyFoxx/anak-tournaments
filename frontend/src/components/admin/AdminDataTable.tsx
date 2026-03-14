"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  SortingState,
  useReactTable,
  Row
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, CircleMinus, LoaderCircle, Search, SlidersHorizontal } from "lucide-react";
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
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const ADMIN_ACTION_COLUMN_ID = "actions";
const ADMIN_ACTION_COLUMN_MIN_WIDTH = 112;
const DEFAULT_PAGE_SIZE_OPTIONS = [10, 15, 25, 50, 100];

function parsePositiveInt(value: string | null, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseSortDir(value: string | null): SortDir {
  return value === "desc" ? "desc" : "asc";
}

export type SortDir = "asc" | "desc";

export interface AdminDataTableProps<TData> {
  // Data
  initialData?: PaginatedResponse<TData>;
  queryKey: (page: number, search: string, pageSize: number, sortField: string | null, sortDir: SortDir) => readonly unknown[];
  queryFn: (page: number, search: string, pageSize: number, sortField: string | null, sortDir: SortDir) => Promise<PaginatedResponse<TData>>;

  // Table configuration
  columns: ColumnDef<TData>[];
  searchPlaceholder?: string;
  emptyMessage?: string;
  initialPageSize?: number;
  pageSizeOptions?: number[];

  // Actions
  onRowClick?: (row: Row<TData>) => void;
  onRowDoubleClick?: (row: Row<TData>) => void;
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
  onRowDoubleClick,
  actions,
  initialPage = 1,
  initialSearch = "",
  initialPageSize = 15,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS
}: AdminDataTableProps<TData>) {
  const pathname = usePathname();
  const defaultPageSize = initialData?.per_page && initialData.per_page > 0 ? initialData.per_page : initialPageSize;
  const [searchValue, setSearchValue] = useState<string>(initialSearch);
  const [debouncedSearchValue] = useDebounce(searchValue, 300);
  const [currentPage, setCurrentPage] = useState<number>(initialPage);
  const [pageSize, setPageSize] = useState<number>(defaultPageSize);
  const [sorting, setSorting] = useState<SortingState>([]);
  const sortField = sorting[0]?.id ?? null;
  const sortDir: SortDir = sorting[0]?.desc ? "desc" : "asc";
  const previousDebouncedSearchRef = useRef(initialSearch);
  const previousPageSizeRef = useRef(defaultPageSize);
  const previousSortRef = useRef<{ field: string | null; dir: SortDir }>({ field: null, dir: "asc" });
  const previousUrlStateRef = useRef({ page: initialPage, search: initialSearch, pageSize: defaultPageSize, sortField: null as string | null, sortDir: "asc" as SortDir });
  const rowClickTimeoutRef = useRef<number | null>(null);
  const safeCurrentPage = Number.isFinite(currentPage) && currentPage > 0 ? currentPage : initialPage;
  const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? pageSize : defaultPageSize;

  // Sync search value with initial search
  useEffect(() => {
    previousDebouncedSearchRef.current = initialSearch;
    setSearchValue(initialSearch);
  }, [initialSearch]);

  useEffect(() => {
    setPageSize(defaultPageSize);
    previousPageSizeRef.current = defaultPageSize;
  }, [defaultPageSize]);

  // Reset to page 1 when search changes
  useEffect(() => {
    if (previousDebouncedSearchRef.current !== debouncedSearchValue) {
      previousDebouncedSearchRef.current = debouncedSearchValue;
      setCurrentPage(1);
    }
  }, [debouncedSearchValue]);

  useEffect(() => {
    if (previousPageSizeRef.current !== pageSize) {
      previousPageSizeRef.current = pageSize;
      setCurrentPage(1);
    }
  }, [pageSize]);

  // Reset to page 1 when sorting changes
  useEffect(() => {
    const prev = previousSortRef.current;
    if (prev.field !== sortField || prev.dir !== sortDir) {
      previousSortRef.current = { field: sortField, dir: sortDir };
      setCurrentPage(1);
    }
  }, [sortField, sortDir]);

  // Fetch data
  const dataQuery = useQuery({
    queryKey: queryKey(safeCurrentPage, debouncedSearchValue, safePageSize, sortField, sortDir),
    queryFn: () => queryFn(safeCurrentPage, debouncedSearchValue, safePageSize, sortField, sortDir),
    placeholderData: (previousData) => previousData,
    initialData:
      initialData &&
      safeCurrentPage === initialPage &&
      debouncedSearchValue === initialSearch &&
      safePageSize === defaultPageSize &&
      sortField === null
        ? initialData
        : undefined
  });

  const data = dataQuery.data ?? initialData ?? { results: [], total: 0, page: 1, per_page: safePageSize };
  const isRefreshing = dataQuery.isFetching && !dataQuery.isLoading;
  const safeTotal = Number.isFinite(data.total) ? data.total : 0;
  const responsePageSize = Number.isFinite(data.per_page) ? data.per_page : undefined;
  const effectivePageSize = responsePageSize && responsePageSize > 0 ? responsePageSize : safePageSize;
  const availablePageSizeOptions = Array.from(new Set([...pageSizeOptions, effectivePageSize])).sort(
    (left, right) => left - right
  );
  const totalPageCount = Math.max(1, Math.ceil(safeTotal / effectivePageSize));
  const rangeStart = safeTotal > 0 ? (safeCurrentPage - 1) * effectivePageSize + 1 : 0;
  const rangeEnd = safeTotal > 0 ? Math.min(safeCurrentPage * effectivePageSize, safeTotal) : 0;

  useEffect(() => {
    if (safeCurrentPage > totalPageCount) {
      setCurrentPage(totalPageCount);
    }
  }, [safeCurrentPage, totalPageCount]);

  // Handle browser back/forward
  useEffect(() => {
    const syncStateFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      const nextPage = parsePositiveInt(params.get("page"), initialPage);
      const nextSearch = params.get("search") ?? initialSearch;
      const nextPageSize = parsePositiveInt(params.get("per_page"), defaultPageSize);
      const nextSortField = params.get("sort") ?? null;
      const nextSortDir = parseSortDir(params.get("dir"));

      previousDebouncedSearchRef.current = nextSearch;
      previousPageSizeRef.current = nextPageSize;
      previousSortRef.current = { field: nextSortField, dir: nextSortDir };
      previousUrlStateRef.current = { page: nextPage, search: nextSearch, pageSize: nextPageSize, sortField: nextSortField, sortDir: nextSortDir };
      setCurrentPage(nextPage);
      setSearchValue(nextSearch);
      setPageSize(nextPageSize);
      setSorting(nextSortField ? [{ id: nextSortField, desc: nextSortDir === "desc" }] : []);
    };

    const handlePopState = () => {
      syncStateFromUrl();
    };

    syncStateFromUrl();
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [defaultPageSize, initialPage, initialSearch]);

  useEffect(() => {
    return () => {
      if (rowClickTimeoutRef.current !== null) {
        window.clearTimeout(rowClickTimeoutRef.current);
      }
    };
  }, []);

  // Update URL when page, search, or sort changes
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const currentSearch = params.get("search") ?? "";
    const currentPageParam = Number.parseInt(params.get("page") ?? "1", 10) || 1;
    const currentPageSizeParam = parsePositiveInt(params.get("per_page"), defaultPageSize);
    const currentSortField = params.get("sort") ?? null;
    const currentSortDir = parseSortDir(params.get("dir"));

    const previousUrlState = previousUrlStateRef.current;
    const searchChanged = previousUrlState.search !== debouncedSearchValue;
    const pageChanged = previousUrlState.page !== safeCurrentPage;
    const pageSizeChanged = previousUrlState.pageSize !== safePageSize;
    const sortFieldChanged = previousUrlState.sortField !== sortField;
    const sortDirChanged = previousUrlState.sortDir !== sortDir;

    if (!searchChanged && !pageChanged && !pageSizeChanged && !sortFieldChanged && !sortDirChanged) {
      return;
    }

    if (
      currentSearch === debouncedSearchValue &&
      currentPageParam === safeCurrentPage &&
      currentPageSizeParam === safePageSize &&
      currentSortField === sortField &&
      currentSortDir === sortDir
    ) {
      previousUrlStateRef.current = {
        page: safeCurrentPage,
        search: debouncedSearchValue,
        pageSize: safePageSize,
        sortField,
        sortDir
      };
      return;
    }

    if (debouncedSearchValue) {
      params.set("search", debouncedSearchValue);
    } else {
      params.delete("search");
    }

    if (safeCurrentPage > 1) {
      params.set("page", String(safeCurrentPage));
    } else {
      params.delete("page");
    }

    if (safePageSize !== defaultPageSize) {
      params.set("per_page", String(safePageSize));
    } else {
      params.delete("per_page");
    }

    if (sortField) {
      params.set("sort", sortField);
      if (sortDir === "desc") {
        params.set("dir", "desc");
      } else {
        params.delete("dir");
      }
    } else {
      params.delete("sort");
      params.delete("dir");
    }

    const query = params.toString();
    const nextUrl = query ? `${pathname}?${query}` : pathname;

    if (searchChanged || pageSizeChanged || sortFieldChanged || sortDirChanged) {
      window.history.replaceState(null, "", nextUrl);
    } else {
      window.history.pushState(null, "", nextUrl);
    }

    previousUrlStateRef.current = {
      page: safeCurrentPage,
      search: debouncedSearchValue,
      pageSize: safePageSize,
      sortField,
      sortDir
    };
  }, [safeCurrentPage, debouncedSearchValue, defaultPageSize, safePageSize, pathname, sortField, sortDir]);

  const table = useReactTable({
    data: data.results ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    onSortingChange: setSorting,
    state: { sorting },
    manualPagination: true,
    manualSorting: true,
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

  const hasRowAction = Boolean(onRowClick || onRowDoubleClick);

  const isInteractiveRowTarget = (target: HTMLElement) => {
    const interactiveElement = target.closest(
      "button, a, input, select, textarea, [role='button'], [role='link'], [data-radix-collection-item]"
    );

    return Boolean(interactiveElement);
  };

  const handleRowClick = (event: React.MouseEvent<HTMLTableRowElement>, row: Row<TData>) => {
    if (!onRowClick) {
      return;
    }

    const target = event.target as HTMLElement;
    if (isInteractiveRowTarget(target)) {
      return;
    }

    if (onRowDoubleClick) {
      if (rowClickTimeoutRef.current !== null) {
        window.clearTimeout(rowClickTimeoutRef.current);
      }

      rowClickTimeoutRef.current = window.setTimeout(() => {
        onRowClick(row);
        rowClickTimeoutRef.current = null;
      }, 200);
      return;
    }

    onRowClick(row);
  };

  const handleRowDoubleClick = (event: React.MouseEvent<HTMLTableRowElement>, row: Row<TData>) => {
    if (!onRowDoubleClick) {
      return;
    }

    const target = event.target as HTMLElement;
    if (isInteractiveRowTarget(target)) {
      return;
    }

    if (rowClickTimeoutRef.current !== null) {
      window.clearTimeout(rowClickTimeoutRef.current);
      rowClickTimeoutRef.current = null;
    }

    onRowDoubleClick(row);
  };

  const handlePageSizeChange = (nextPageSize: number) => {
    setCurrentPage(1);
    setPageSize(nextPageSize);
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
              {safeTotal > 0
                ? `Showing ${rangeStart}-${rangeEnd} of ${safeTotal} records`
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

      <div className="rounded-2xl border border-border/70 bg-card/70 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-gradient-to-r from-muted/35 via-muted/20 to-background/20 px-4 py-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            {isRefreshing ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
            <span>{isRefreshing ? "Refreshing data" : "Snapshot ready"}</span>
          </div>
          <span>{searchValue ? `Filtered by “${searchValue}”` : "Showing full dataset"}</span>
        </div>

        <div className="overflow-x-auto rounded-b-2xl">
          <Table className="min-w-full border-separate border-spacing-0">
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id} className="border-border/60 hover:bg-transparent">
                  {headerGroup.headers.map((header, index) => {
                    const isActionColumn = header.column.id === ADMIN_ACTION_COLUMN_ID;
                    const isFirstColumn = index === 0;
                    const isLastColumn = index === headerGroup.headers.length - 1;

                    const canSort = header.column.getCanSort();
                    const sortDir = header.column.getIsSorted();

                    return (
                      <TableHead
                        key={header.id}
                        className={cn(
                          "sticky top-0 z-10 h-11 border-b border-border/60 bg-background/95 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/90 backdrop-blur supports-[backdrop-filter]:bg-background/80",
                          isFirstColumn && "pl-4 sm:pl-5",
                          isLastColumn && "pr-4 sm:pr-5",
                          isActionColumn ? "text-right" : "text-left"
                        )}
                        style={getColumnStyle(header.column)}
                      >
                        {header.isPlaceholder ? null : canSort ? (
                          <button
                            type="button"
                            onClick={header.column.getToggleSortingHandler()}
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded transition-colors hover:text-foreground",
                              sortDir ? "text-foreground" : "text-muted-foreground/90"
                            )}
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            {sortDir === "asc" ? (
                              <ArrowUp className="h-3 w-3 shrink-0" />
                            ) : sortDir === "desc" ? (
                              <ArrowDown className="h-3 w-3 shrink-0" />
                            ) : (
                              <ArrowUpDown className="h-3 w-3 shrink-0 opacity-40" />
                            )}
                          </button>
                        ) : (
                          flexRender(header.column.columnDef.header, header.getContext())
                        )}
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
                      "group border-b border-border/45 transition-colors duration-200 odd:bg-background/[0.92] even:bg-muted/[0.2] hover:bg-accent/30 data-[state=selected]:bg-accent/35",
                      hasRowAction &&
                        "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2"
                    )}
                    onClick={(event) => handleRowClick(event, row)}
                    onDoubleClick={(event) => handleRowDoubleClick(event, row)}
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
                            isActionColumn && "whitespace-nowrap text-right",
                            index === 0 && "text-muted-foreground"
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
        </div>
      </div>

      {safeTotal > 0 && (
        <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-card/70 px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {rangeStart} to {rangeEnd} of {safeTotal} results
          </p>
          <PaginationControlled
            page={safeCurrentPage}
            totalCount={safeTotal}
            pageSize={effectivePageSize}
            pageSizeSelectOptions={{ pageSizeOptions: availablePageSizeOptions }}
            onSetPage={setCurrentPage}
            onSetPageSize={handlePageSizeChange}
          />
        </div>
      )}
    </div>
  );
}
