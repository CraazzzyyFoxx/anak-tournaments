"use client";

/**
 * Shared "actions" column factory for the CRUD admin pages (encounters,
 * players, standings) that render a plain edit + delete icon-button pair,
 * each independently gated by its own permission flag. This is a different
 * pattern from `catalog-table-columns.tsx`'s `createEntityActionsColumn`,
 * which renders a single dropdown menu gated by one `isSuperuser` flag for
 * the game-catalogue admin pages (maps, heroes, gamemodes).
 */

import { ColumnDef } from "@tanstack/react-table";
import { Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";

interface RowActionsColumnOptions<T> {
  canUpdate: boolean;
  canDelete: boolean;
  onEdit: (row: T) => void;
  onDelete: (row: T) => void;
  getEditLabel: (row: T) => string;
  getDeleteLabel: (row: T) => string;
}

/**
 * "Actions" column: an edit pencil + delete trash icon button pair, each
 * independently gated by its own permission flag.
 */
export function createRowActionsColumn<T>({
  canUpdate,
  canDelete,
  onEdit,
  onDelete,
  getEditLabel,
  getDeleteLabel
}: RowActionsColumnOptions<T>): ColumnDef<T> {
  return {
    id: "actions",
    cell: ({ row }) =>
      canUpdate || canDelete ? (
        <div className="flex items-center gap-2">
          {canUpdate ? (
            <Button
              aria-label={getEditLabel(row.original)}
              variant="ghost"
              size="icon"
              onClick={() => onEdit(row.original)}
            >
              <Pencil className="h-4 w-4" />
            </Button>
          ) : null}
          {canDelete ? (
            <Button
              aria-label={getDeleteLabel(row.original)}
              variant="ghost"
              size="icon"
              onClick={() => onDelete(row.original)}
              className="text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      ) : null
  };
}
