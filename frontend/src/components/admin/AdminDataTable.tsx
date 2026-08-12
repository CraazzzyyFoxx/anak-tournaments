"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  SortingState,
  useReactTable,
  Row,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, CircleMinus, LoaderCircle, Search } from "lucide-react";
import { usePathname } from "next/navigation";
import { useDebounce } from "use-debounce";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PaginatedResponse } from "@/types/pagination.types";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const ADMIN_ACTION_COLUMN_ID = "actions";
const ADMIN_ACTION_COLUMN_MIN_WIDTH = 80;
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
  queryKey: (page: number, search: string, pageSize: number, sortField: string | null, sortDir: SortDir) => readonly unknown[];
  queryFn: (page: number, search: string, pageSize: number, sortField: string | null, sortDir: SortDir) => Promise<PaginatedResponse<TData>>;

  columns: ColumnDef<TData>[];
  searchPlaceholder?: string;
  emptyMessage?: string;
  initialPageSize?: number;
  pageSizeOptions?: number[];

  /**
   * Opaque identity of filters the caller owns (chips, scope selects) rather
   * than this table. Changing it resets to page 1: narrowing a filter while on
   * page 4 otherwise lands on a page the new result set does not have.
   */
  filterKey?: string;

  onRowClick?: (row: Row<TData>) => void;
  onRowDoubleClick?: (row: Row<TData>) => void;
  actions?: React.ReactNode;
}

export function AdminDataTable<TData>({
  queryKey,
  queryFn,
  columns,
  searchPlaceholder = "Search…",
  emptyMessage = "No records to show yet.",
  onRowClick,
  onRowDoubleClick,
  actions,
  initialPageSize = 15,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  filterKey,
}: AdminDataTableProps<TData>) {
  const pathname = usePathname();
  const searchInputId = useId();
  const rowHintId = useId();
  const [searchValue, setSearchValue] = useState("");
  const [debouncedSearchValue] = useDebounce(searchValue, 300);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(initialPageSize);
  const [sorting, setSorting] = useState<SortingState>([]);
  const sortField = sorting[0]?.id ?? null;
  const sortDir: SortDir = sorting[0]?.desc ? "desc" : "asc";
  const previousDebouncedSearchRef = useRef("");
  const previousPageSizeRef = useRef(initialPageSize);
  const previousFilterKeyRef = useRef(filterKey);
  const previousSortRef = useRef<{ field: string | null; dir: SortDir }>({ field: null, dir: "asc" });
  const previousUrlStateRef = useRef({ page: 1, search: "", pageSize: initialPageSize, sortField: null as string | null, sortDir: "asc" as SortDir });
  const rowClickTimeoutRef = useRef<number | null>(null);
  const safeCurrentPage = Number.isFinite(currentPage) && currentPage > 0 ? currentPage : 1;
  const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? pageSize : initialPageSize;

  useEffect(() => {
    setPageSize(initialPageSize);
    previousPageSizeRef.current = initialPageSize;
  }, [initialPageSize]);

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

  useEffect(() => {
    if (previousFilterKeyRef.current !== filterKey) {
      previousFilterKeyRef.current = filterKey;
      setCurrentPage(1);
    }
  }, [filterKey]);

  useEffect(() => {
    const prev = previousSortRef.current;
    if (prev.field !== sortField || prev.dir !== sortDir) {
      previousSortRef.current = { field: sortField, dir: sortDir };
      setCurrentPage(1);
    }
  }, [sortField, sortDir]);

  const dataQuery = useQuery({
    queryKey: queryKey(safeCurrentPage, debouncedSearchValue, safePageSize, sortField, sortDir),
    queryFn: () => queryFn(safeCurrentPage, debouncedSearchValue, safePageSize, sortField, sortDir),
    placeholderData: (previousData) => previousData,
  });

  const data = dataQuery.data ?? { results: [], total: 0, page: 1, per_page: safePageSize };
  const isRefreshing = dataQuery.isFetching && !dataQuery.isLoading;
  const safeTotal = Number.isFinite(data.total) ? data.total : 0;
  const responsePageSize = Number.isFinite(data.per_page) ? data.per_page : undefined;
  const effectivePageSize = responsePageSize && responsePageSize > 0 ? responsePageSize : safePageSize;
  const availablePageSizeOptions = Array.from(new Set([...pageSizeOptions, effectivePageSize])).sort((a, b) => a - b);
  const totalPageCount = Math.max(1, Math.ceil(safeTotal / effectivePageSize));
  const rangeStart = safeTotal > 0 ? (safeCurrentPage - 1) * effectivePageSize + 1 : 0;
  const rangeEnd = safeTotal > 0 ? Math.min(safeCurrentPage * effectivePageSize, safeTotal) : 0;

  useEffect(() => {
    if (safeCurrentPage > totalPageCount) {
      setCurrentPage(totalPageCount);
    }
  }, [safeCurrentPage, totalPageCount]);

  // Browser back/forward sync
  useEffect(() => {
    const syncStateFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      const nextPage = parsePositiveInt(params.get("page"), 1);
      const nextSearch = params.get("search") ?? "";
      const nextPageSize = parsePositiveInt(params.get("per_page"), initialPageSize);
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

    syncStateFromUrl();
    window.addEventListener("popstate", syncStateFromUrl);
    return () => window.removeEventListener("popstate", syncStateFromUrl);
  }, [initialPageSize]);

  useEffect(() => {
    return () => {
      if (rowClickTimeoutRef.current !== null) window.clearTimeout(rowClickTimeoutRef.current);
    };
  }, []);

  // URL sync
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const prev = previousUrlStateRef.current;
    const searchChanged = prev.search !== debouncedSearchValue;
    const pageChanged = prev.page !== safeCurrentPage;
    const pageSizeChanged = prev.pageSize !== safePageSize;
    const sortFieldChanged = prev.sortField !== sortField;
    const sortDirChanged = prev.sortDir !== sortDir;

    if (!searchChanged && !pageChanged && !pageSizeChanged && !sortFieldChanged && !sortDirChanged) return;

    const currentSearch = params.get("search") ?? "";
    const currentPageParam = Number.parseInt(params.get("page") ?? "1", 10) || 1;
    const currentPageSizeParam = parsePositiveInt(params.get("per_page"), initialPageSize);
    const currentSortField = params.get("sort") ?? null;
    const currentSortDir = parseSortDir(params.get("dir"));

    if (
      currentSearch === debouncedSearchValue &&
      currentPageParam === safeCurrentPage &&
      currentPageSizeParam === safePageSize &&
      currentSortField === sortField &&
      currentSortDir === sortDir
    ) {
      previousUrlStateRef.current = { page: safeCurrentPage, search: debouncedSearchValue, pageSize: safePageSize, sortField, sortDir };
      return;
    }

    if (debouncedSearchValue) params.set("search", debouncedSearchValue); else params.delete("search");
    if (safeCurrentPage > 1) params.set("page", String(safeCurrentPage)); else params.delete("page");
    if (safePageSize !== initialPageSize) params.set("per_page", String(safePageSize)); else params.delete("per_page");
    if (sortField) { params.set("sort", sortField); if (sortDir === "desc") params.set("dir", "desc"); else params.delete("dir"); } else { params.delete("sort"); params.delete("dir"); }

    const query = params.toString();
    const nextUrl = query ? `${pathname}?${query}` : pathname;

    if (searchChanged || pageSizeChanged || sortFieldChanged || sortDirChanged) {
      window.history.replaceState(null, "", nextUrl);
    } else {
      window.history.pushState(null, "", nextUrl);
    }

    previousUrlStateRef.current = { page: safeCurrentPage, search: debouncedSearchValue, pageSize: safePageSize, sortField, sortDir };
  }, [safeCurrentPage, debouncedSearchValue, initialPageSize, safePageSize, pathname, sortField, sortDir]);

  const table = useReactTable({
    data: data.results ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    onSortingChange: setSorting,
    state: { sorting },
    manualPagination: true,
    manualSorting: true,
    rowCount: data.total ?? 0,
  });

  const getColumnStyle = (column: { id: string; getSize: () => number; columnDef: { size?: number } }) => {
    const configuredSize = typeof column.columnDef.size === "number" ? column.getSize() : undefined;
    const width = column.id === ADMIN_ACTION_COLUMN_ID ? Math.max(configuredSize ?? 0, ADMIN_ACTION_COLUMN_MIN_WIDTH) : configuredSize;
    return width ? { width, minWidth: width } : undefined;
  };

  const hasRowAction = Boolean(onRowClick || onRowDoubleClick);

  const isInteractiveRowTarget = (target: HTMLElement) => {
    return Boolean(target.closest("button, a, input, select, textarea, [role='button'], [role='link'], [data-radix-collection-item]"));
  };

  const handleRowClick = (event: React.MouseEvent<HTMLTableRowElement>, row: Row<TData>) => {
    if (!onRowClick) return;
    if (isInteractiveRowTarget(event.target as HTMLElement)) return;

    if (onRowDoubleClick) {
      if (rowClickTimeoutRef.current !== null) window.clearTimeout(rowClickTimeoutRef.current);
      rowClickTimeoutRef.current = window.setTimeout(() => { onRowClick(row); rowClickTimeoutRef.current = null; }, 200);
      return;
    }
    onRowClick(row);
  };

  const handleRowDoubleClick = (event: React.MouseEvent<HTMLTableRowElement>, row: Row<TData>) => {
    if (!onRowDoubleClick) return;
    if (isInteractiveRowTarget(event.target as HTMLElement)) return;
    if (rowClickTimeoutRef.current !== null) { window.clearTimeout(rowClickTimeoutRef.current); rowClickTimeoutRef.current = null; }
    onRowDoubleClick(row);
  };

  const handlePageSizeChange = (nextPageSize: number) => {
    setCurrentPage(1);
    setPageSize(nextPageSize);
  };

  const handleRowKeyDown = (event: React.KeyboardEvent<HTMLTableRowElement>, row: Row<TData>) => {
    if (!onRowClick) return;
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onRowClick(row); }
  };

  return (
    <div className="rounded-xl border border-border/50 bg-card/50 overflow-hidden">
      {/* ── TOOLBAR: search + actions ──────────────────── */}
      <div className="flex items-center justify-between gap-3 border-b border-border/40 px-4 py-2.5">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {/* Search */}
          <div className="relative w-full max-w-xs">
            <Label htmlFor={searchInputId} className="sr-only">{searchPlaceholder}</Label>
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id={searchInputId}
              autoComplete="off"
              className="h-9 border-border bg-muted/30 pl-9 text-sm placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:border-ring"
              name="admin-table-search"
              placeholder={searchPlaceholder}
              value={searchValue}
              onChange={(event) => setSearchValue(event.target.value)}
            />
          </div>

          {isRefreshing ? (
            <span role="status" className="flex shrink-0 items-center text-muted-foreground">
              <LoaderCircle aria-hidden className="size-3 animate-spin" />
              <span className="sr-only">Refreshing results…</span>
            </span>
          ) : null}
        </div>

        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>

      {/* ── TABLE ───────────────────────────────────────── */}
      <div className="overflow-x-auto">
        {onRowClick ? (
          <p id={rowHintId} className="sr-only">
            Press Enter to open the focused row.
          </p>
        ) : null}
        <Table className="min-w-full border-separate border-spacing-0">
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header, index) => {
                  const isActionColumn = header.column.id === ADMIN_ACTION_COLUMN_ID;
                  const isFirstColumn = index === 0;
                  const isLastColumn = index === headerGroup.headers.length - 1;
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();

                  return (
                    <TableHead
                      key={header.id}
                      aria-sort={
                        canSort
                          ? sorted === "asc"
                            ? "ascending"
                            : sorted === "desc"
                              ? "descending"
                              : "none"
                          : undefined
                      }
                      className={cn(
                        "h-9 border-b border-border/40 bg-muted/20 text-xs font-medium text-muted-foreground",
                        isFirstColumn && "pl-4",
                        isLastColumn && "pr-4",
                        isActionColumn ? "text-right" : "text-left",
                      )}
                      style={getColumnStyle(header.column)}
                    >
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className={cn(
                            "inline-flex items-center gap-1 rounded transition-colors hover:text-foreground",
                            sorted ? "text-foreground" : "text-muted-foreground",
                          )}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted === "asc" ? (
                            <ArrowUp aria-hidden className="size-3 shrink-0" />
                          ) : sorted === "desc" ? (
                            <ArrowDown aria-hidden className="size-3 shrink-0" />
                          ) : (
                            <ArrowUpDown aria-hidden className="size-3 shrink-0 opacity-30" />
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
                    "group border-b border-border/30 transition-colors hover:bg-accent/20 data-[state=selected]:bg-accent/30",
                    hasRowAction && "cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50 focus-visible:ring-inset",
                  )}
                  onClick={(event) => handleRowClick(event, row)}
                  onDoubleClick={(event) => handleRowDoubleClick(event, row)}
                  onKeyDown={(event) => handleRowKeyDown(event, row)}
                  tabIndex={onRowClick ? 0 : undefined}
                  aria-describedby={onRowClick ? rowHintId : undefined}
                >
                  {row.getVisibleCells().map((cell, index) => {
                    const isActionColumn = cell.column.id === ADMIN_ACTION_COLUMN_ID;
                    const isFirstColumn = index === 0;
                    const isLastColumn = index === row.getVisibleCells().length - 1;

                    return (
                      <TableCell
                        key={cell.id}
                        className={cn(
                          "py-2.5 text-sm",
                          isFirstColumn && "pl-4 text-muted-foreground",
                          isLastColumn && "pr-4",
                          isActionColumn && "whitespace-nowrap text-right",
                        )}
                        style={getColumnStyle(cell.column)}
                      >
                        {isActionColumn ? (
                          <div className="flex w-full items-center justify-end opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
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
                <TableCell colSpan={columns.length} className="py-8 text-center">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <CircleMinus aria-hidden className="size-5 text-muted-foreground/40" />
                    <p className="text-sm text-muted-foreground">{emptyMessage}</p>
                    {searchValue ? (
                      <>
                        <p className="text-xs text-muted-foreground">Nothing matches the current search.</p>
                        <Button type="button" variant="outline" size="sm" onClick={() => setSearchValue("")}>
                          Clear search
                        </Button>
                      </>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* ── FOOTER: pagination ─────────────────────────── */}
      {safeTotal > 0 && (
        <div className="flex items-center justify-between gap-3 border-t border-border/40 px-4 py-2">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="tabular-nums">{rangeStart}–{rangeEnd} of {safeTotal}</span>
            <div className="flex items-center gap-1.5">
              <span>Rows</span>
              <Select value={String(effectivePageSize)} onValueChange={(v) => handlePageSizeChange(Number(v))}>
                <SelectTrigger aria-label="Rows per page" className="h-8 w-auto gap-1 border-border bg-muted/30 px-2.5 text-sm tabular-nums text-muted-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availablePageSizeOptions.map((opt) => (
                    <SelectItem key={opt} value={String(opt)} className="text-xs tabular-nums">{opt}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage(Math.max(safeCurrentPage - 1, 1))}
              disabled={safeCurrentPage <= 1}
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/30 hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
              aria-label="Previous page"
            >
              <ChevronLeft aria-hidden className="size-4" />
            </button>

            {(() => {
              const maxVisible = 5;

              const pageButton = (page: number) => (
                <button
                  key={page}
                  type="button"
                  onClick={() => setCurrentPage(page)}
                  aria-label={`Page ${page}`}
                  aria-current={safeCurrentPage === page ? "page" : undefined}
                  className={cn(
                    "flex size-7 items-center justify-center rounded-md text-xs tabular-nums transition-colors",
                    safeCurrentPage === page
                      ? "bg-primary text-primary-foreground font-medium"
                      : "text-muted-foreground hover:bg-accent/30 hover:text-foreground",
                  )}
                >
                  {page}
                </button>
              );

              const gap = (key: string) => (
                <span key={key} aria-hidden className="flex size-7 items-center justify-center text-xs text-muted-foreground">…</span>
              );

              if (totalPageCount <= maxVisible) {
                return Array.from({ length: totalPageCount }, (_, index) => pageButton(index + 1));
              }

              const pages: React.ReactNode[] = [pageButton(1)];
              if (safeCurrentPage > 3) pages.push(gap("gap-start"));
              const start = Math.max(2, safeCurrentPage - 1);
              const end = Math.min(totalPageCount - 1, safeCurrentPage + 1);
              for (let i = start; i <= end; i++) pages.push(pageButton(i));
              if (safeCurrentPage < totalPageCount - 2) pages.push(gap("gap-end"));
              pages.push(pageButton(totalPageCount));

              return pages;
            })()}

            <button
              onClick={() => setCurrentPage(Math.min(safeCurrentPage + 1, totalPageCount))}
              disabled={safeCurrentPage >= totalPageCount}
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/30 hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
              aria-label="Next page"
            >
              <ChevronRight aria-hidden className="size-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
