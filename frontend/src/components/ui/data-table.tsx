"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  flexRender,
  type Cell,
  type ColumnMeta,
  type Row,
  type Table as TanstackTable
} from "@tanstack/react-table";

import { DataTableSortButton } from "@/components/DataTableSortButton";
import { PageStateCard } from "@/components/ui/page-state-card";
import { Skeleton } from "@/components/ui/skeleton";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/** Column metadata this table understands. */
export interface DataTableColumnMeta {
  /** Applies `tabular-nums` so digits stop jittering as values change. */
  numeric?: boolean;
  /** Extra classes for this column's `<th>`. */
  headerClassName?: string;
  /** Extra classes for this column's `<td>`s. */
  cellClassName?: string;
}

/**
 * TanStack ships `ColumnMeta` as an empty interface, so a plain object literal
 * trips the excess-property check. Cast once, here, instead of scattering casts
 * through every column definition.
 */
export const columnMeta = <TData,>(meta: DataTableColumnMeta) =>
  meta as ColumnMeta<TData, unknown>;

const readColumnMeta = (meta: unknown): DataTableColumnMeta =>
  (meta ?? {}) as DataTableColumnMeta;

export interface DataTableProps<TData> {
  table: TanstackTable<TData>;
  /**
   * Accessible name for the horizontal scroll region. A scrollable area needs a
   * name and a tab stop, or keyboard users cannot reach the columns that sit
   * off-screen on a phone.
   */
  label: string;
  isLoading?: boolean;
  skeletonRows?: number;
  /** Replaces the whole table when the row model is empty. */
  emptyState?: React.ReactNode;
  /** Cell alignment for every column; per-column overrides go through `meta`. */
  align?: "left" | "center";
  /** Virtualized slice to render instead of the full row model. */
  virtualRows?: Row<TData>[];
  /** Spacer heights that keep a virtualized slice at the right scroll offset. */
  paddingTop?: number;
  paddingBottom?: number;
  /**
   * Makes each row a keyboard-activatable navigation target (focusable, Enter
   * and Space activate). Clicks that land on a nested link or button are left
   * alone so the inner control still wins.
   */
  rowHref?: (row: Row<TData>) => string;
  /** Accessible name for a navigable row — pair it with `rowHref`. */
  rowLabel?: (row: Row<TData>) => string;
  /** Per-cell class hook (e.g. a heat-mapped score column). */
  cellClassName?: (cell: Cell<TData, unknown>) => string | undefined;
  /** Per-cell inline style hook, for values that cannot be expressed as classes. */
  cellStyle?: (cell: Cell<TData, unknown>) => React.CSSProperties | undefined;
  className?: string;
  /** Classes for the scroll region — max heights, sticky contexts. */
  scrollClassName?: string;
  scrollRef?: React.Ref<HTMLDivElement>;
}

/**
 * The single TanStack↔markup bridge for the site.
 *
 * It owns the parts every hand-inlined copy forgot: `scope="col"` on headers,
 * `aria-sort`, a named and focusable horizontal scroll region, skeleton rows
 * while loading, a real empty state instead of a bare "No results." cell, and
 * `tabular-nums` on numeric columns.
 */
export function DataTable<TData>({
  table,
  label,
  isLoading = false,
  skeletonRows = 6,
  emptyState,
  align = "left",
  virtualRows,
  paddingTop = 0,
  paddingBottom = 0,
  rowHref,
  rowLabel,
  cellClassName,
  cellStyle,
  className,
  scrollClassName,
  scrollRef
}: Readonly<DataTableProps<TData>>) {
  const router = useRouter();

  const modelRows = table.getRowModel().rows;
  const renderRows = virtualRows ?? modelRows;
  const columnCount = Math.max(table.getVisibleLeafColumns().length, 1);
  const alignClass = align === "center" ? "text-center" : undefined;

  if (!isLoading && modelRows.length === 0) {
    return <>{emptyState ?? <PageStateCard state="empty" />}</>;
  }

  return (
    <div
      ref={scrollRef}
      role="region"
      aria-label={label}
      tabIndex={0}
      className={cn(
        "relative w-full overflow-auto rounded-[inherit] outline-none",
        "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--aqt-teal)]",
        scrollClassName
      )}
    >
      <table className={cn("w-full caption-bottom text-sm", className)}>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const meta = readColumnMeta(header.column.columnDef.meta);
                const headerDef = header.column.columnDef.header;
                const canSort = header.column.getCanSort();
                const sorted = header.column.getIsSorted();

                return (
                  <TableHead
                    key={header.id}
                    scope="col"
                    colSpan={header.colSpan}
                    aria-sort={
                      canSort
                        ? sorted === "asc"
                          ? "ascending"
                          : sorted === "desc"
                            ? "descending"
                            : "none"
                        : undefined
                    }
                    className={cn(alignClass, meta.numeric && "tabular-nums", meta.headerClassName)}
                  >
                    {header.isPlaceholder ? null : canSort && typeof headerDef === "string" ? (
                      // The header cell already centers inline content via `align`.
                      <DataTableSortButton column={header.column} label={headerDef} />
                    ) : (
                      flexRender(headerDef, header.getContext())
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>

        <TableBody>
          {isLoading ? (
            Array.from({ length: skeletonRows }).map((_, rowIndex) => (
              <TableRow key={`skeleton-${rowIndex}`}>
                {Array.from({ length: columnCount }).map((__, cellIndex) => (
                  <TableCell key={cellIndex}>
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <>
              {paddingTop > 0 ? (
                <tr aria-hidden>
                  <td colSpan={columnCount} style={{ height: paddingTop }} />
                </tr>
              ) : null}

              {renderRows.map((row) => {
                const href = rowHref?.(row);

                return (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() ? "selected" : undefined}
                    {...(href
                      ? {
                          tabIndex: 0,
                          "aria-label": rowLabel?.(row),
                          className: "cursor-pointer",
                          onClick: (event: React.MouseEvent<HTMLTableRowElement>) => {
                            if ((event.target as HTMLElement).closest("a,button,input,label")) return;
                            router.push(href);
                          },
                          onKeyDown: (event: React.KeyboardEvent<HTMLTableRowElement>) => {
                            if (event.key !== "Enter" && event.key !== " ") return;
                            if (event.target !== event.currentTarget) return;
                            event.preventDefault();
                            router.push(href);
                          }
                        }
                      : {})}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const meta = readColumnMeta(cell.column.columnDef.meta);

                      return (
                        <TableCell
                          key={cell.id}
                          className={cn(
                            alignClass,
                            meta.numeric && "tabular-nums",
                            meta.cellClassName,
                            cellClassName?.(cell)
                          )}
                          style={cellStyle?.(cell)}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })}

              {paddingBottom > 0 ? (
                <tr aria-hidden>
                  <td colSpan={columnCount} style={{ height: paddingBottom }} />
                </tr>
              ) : null}
            </>
          )}
        </TableBody>
      </table>
    </div>
  );
}
