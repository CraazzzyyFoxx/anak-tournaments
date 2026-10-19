"use client";

import { useMemo } from "react";
import type { ColumnDef, ColumnOrderState, ColumnSizingState } from "@tanstack/react-table";

import { useLocalStorageState } from "@/components/data-table/host";
import { ADMIN_ACTION_COLUMN_ID, columnDefId } from "@/components/data-table/columns";

export type AdminTableDensity = "comfortable" | "compact";

/**
 * Per-user table preferences. Widths and order are per screen (the caller's
 * `columnsStorageKey`, falling back to the route); density is one setting
 * everywhere.
 */
export function useTablePreferences<TData>(prefsKey: string, columns: ColumnDef<TData>[]) {
  const [density, setDensity] = useLocalStorageState<AdminTableDensity>("admin-table-density", "comfortable");
  const [columnSizing, setColumnSizing] = useLocalStorageState<ColumnSizingState>(`${prefsKey}:sizing`, {});
  const [savedColumnOrder, setColumnOrder] = useLocalStorageState<ColumnOrderState>(`${prefsKey}:order`, []);
  // The saved order is a preference over the columns that existed when it was
  // written. Columns added since (a conditional column, a custom field that
  // arrived from a query) would otherwise be appended after the actions
  // column, so the order handed to TanStack is rebuilt from both: known
  // columns in saved order, new ones in definition order, actions last.
  // Memoised: a fresh array every render makes TanStack rebuild its column
  // list and every cell, and the column layout the body rows compare with them.
  const columnOrder = useMemo<ColumnOrderState>(() => {
    const definedColumnIds = columns.map(columnDefId).filter((id) => id && id !== ADMIN_ACTION_COLUMN_ID);
    return [
      ...savedColumnOrder.filter((id) => definedColumnIds.includes(id)),
      ...definedColumnIds.filter((id) => !savedColumnOrder.includes(id)),
      ...(columns.some((column) => columnDefId(column) === ADMIN_ACTION_COLUMN_ID) ? [ADMIN_ACTION_COLUMN_ID] : [])
    ];
  }, [columns, savedColumnOrder]);

  return { density, setDensity, columnSizing, setColumnSizing, columnOrder, setColumnOrder };
}
