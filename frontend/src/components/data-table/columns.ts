import type { ColumnDef, ColumnMeta } from "@tanstack/react-table";
import type React from "react";

import type { AdminColumnFilterSpec } from "@/components/data-table/filters";
import type { KebabAction } from "@/components/data-table/kebab-column";

/** Id of the row-actions column, which always sits last and never moves. */
export const ADMIN_ACTION_COLUMN_ID = "actions";

/**
 * The id TanStack will give a column definition, before a table exists to ask.
 * Accessor columns fall back to their key; anything else must declare an `id`.
 */
export function columnDefId<TData>(column: ColumnDef<TData>): string {
  if (column.id) return column.id;
  return "accessorKey" in column && typeof column.accessorKey === "string" ? column.accessorKey : "";
}

/** Breakpoint below which a column is hidden entirely. */
type AdminColumnResponsive = "always" | "sm" | "md" | "lg";

/** Column category, used to group the "Columns" picker. */
export type AdminColumnCategory = "core" | "meta" | "admin";

/** Column metadata `DataTable` understands. */
export interface AdminColumnMeta<TData = unknown> {
  /** Column filter contract for `kit/FilterBar` and the table's engine. */
  filter?: AdminColumnFilterSpec;
  /** Picker group. Columns without one are not offered for hiding. */
  category?: AdminColumnCategory;
  /** Hidden until the user turns it on in the picker. */
  defaultHidden?: boolean;
  /** Never hideable — rendered checked and disabled in the picker. */
  mandatory?: boolean;
  responsive?: AdminColumnResponsive;
  /**
   * Pin this column while the table scrolls sideways: `true`/`"left"` join a
   * left-edge prefix of the visible columns, `"right"` a right-edge suffix
   * (the actions column then pins at the very edge). A flagged column outside
   * its prefix/suffix is not pinned — it would park over the wrong neighbours.
   * Pinned columns declare `size`: the offsets are summed, not measured.
   */
  sticky?: boolean | "left" | "right";
  align?: "left" | "center" | "right";
  /** Extra classes for this column's `<th>` and `<td>`s (widths, min-widths). */
  className?: string;
  /** Classes for the `<th>` only, when `className` would also restyle every body cell. */
  headerClassName?: string;
  /** Explains a terse header without widening it: an info icon beside the label, outside the sort button. */
  headerTooltip?: React.ReactNode;
  /**
   * Left-aligned cells truncate by default so a long value cannot paint over
   * its neighbour; `false` wraps instead, `true` also puts the value in a `title`.
   */
  ellipsis?: boolean;
  /** Overrides the table's `cellAlign` for this column — one tall stacked cell in a middle-aligned table. */
  valign?: "top" | "middle";
  /** Keeps a short value (a date, a score) on one line when the column is squeezed. */
  nowrap?: boolean;
  /**
   * Per-row props for this column's `<td>` (tint a status, explain a value).
   * No `colSpan`/`rowSpan`: a spanning cell breaks row virtualisation and the
   * sticky offset arithmetic.
   */
  onCell?: (row: TData) =>
    | { className?: string; style?: React.CSSProperties; align?: "left" | "center" | "right"; title?: string }
    | undefined;
  /**
   * Text this column contributes to the toolbar search in client mode. Absent
   * means the column is not searchable — a cell of badges has no useful text.
   */
  searchValue?: (row: TData) => string | null | undefined;
  /** Numeric cells: `tabular-nums` so digits stop jittering between renders. */
  numeric?: boolean;
  /**
   * Row actions, set by `createKebabColumn`. The table mirrors them into a
   * right-click / long-press context menu on the row.
   */
  rowActions?: (row: TData) => KebabAction[];
}

/**
 * TanStack ships `ColumnMeta` as an empty interface, so a plain object literal
 * trips the excess-property check. Cast once, here, instead of scattering casts
 * through every admin column definition.
 */
export const columnMeta = <TData,>(meta: AdminColumnMeta<TData>) =>
  meta as ColumnMeta<TData, unknown>;

export function readColumnMeta<TData>(meta: unknown): AdminColumnMeta<TData> {
  return (meta ?? {}) as AdminColumnMeta<TData>;
}

export const RESPONSIVE_CLASS: Record<AdminColumnResponsive, string> = {
  always: "",
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell"
};

export const ALIGN_CLASS: Record<"left" | "center" | "right", string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right"
};

export const ALIGN_FLEX_CLASS: Record<"left" | "center" | "right", string> = {
  left: "justify-start",
  center: "justify-center",
  right: "justify-end"
};
