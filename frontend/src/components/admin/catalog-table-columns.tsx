"use client";

/**
 * Shared table-column factories for the game-catalogue admin pages (maps,
 * heroes, gamemodes). All three render the same "Aliases" count column and
 * the same superuser-gated edit/delete dropdown, so both live here instead of
 * being copy-pasted three times.
 */

import { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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

interface EntityActionsColumnOptions<T> {
  /** Sentence-case entity noun used in labels, e.g. "hero", "map", "gamemode". */
  entityLabel: string;
  getName: (row: T) => string;
  isSuperuser: boolean;
  onEdit: (row: T) => void;
  onDelete: (row: T) => void;
}

/**
 * "Actions" column: a dropdown menu with edit/delete, gated by `isSuperuser`
 * (renders nothing otherwise — same gate as `CatalogToolbarActions`).
 */
export function createEntityActionsColumn<T>({
  entityLabel,
  getName,
  isSuperuser,
  onEdit,
  onDelete,
}: EntityActionsColumnOptions<T>): ColumnDef<T> {
  return {
    id: "actions",
    size: 50,
    cell: ({ row }) => {
      if (!isSuperuser) {
        return null;
      }

      const entity = row.original;
      const name = getName(entity);

      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button aria-label={`Open actions for ${name}`} variant="ghost" size="icon">
              <MoreHorizontal aria-hidden className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel className="truncate">{name}</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => onEdit(entity)}>
              <Pencil aria-hidden className="mr-2 h-4 w-4" />
              Edit {entityLabel}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onDelete(entity)} className="text-destructive">
              <Trash2 aria-hidden className="mr-2 h-4 w-4" />
              Delete {entityLabel}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    },
  };
}
