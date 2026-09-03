"use client";

/**
 * Shared table-column factory for the game-catalogue admin pages (maps,
 * heroes, gamemodes). All three render the same "Aliases" count column, so it
 * lives here instead of being copy-pasted three times.
 *
 * Row actions are NOT here: they are `kit/kebab-column.tsx`'s `createKebabColumn`,
 * the panel's single actions convention.
 */

import { ColumnDef } from "@tanstack/react-table";

import { Badge } from "@/components/ui/badge";

/**
 * "Aliases" column: a badge with the alias count, or an em-dash when there
 * are none. `getAliases` reads the row's alias array so the column works for
 * any catalogue entity shape.
 */
export function createAliasesColumn<T>(
  getAliases: (row: T) => string[] | undefined
): ColumnDef<T> {
  return {
    id: "aliases",
    header: "Aliases",
    size: 96,
    enableSorting: false,
    cell: ({ row }) => {
      const count = getAliases(row.original)?.length ?? 0;
      return count > 0 ? (
        <Badge variant="secondary">{count}</Badge>
      ) : (
        <span className="text-sm text-muted-foreground">—</span>
      );
    },
  };
}
