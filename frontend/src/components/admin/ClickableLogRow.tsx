"use client";

import type { ReactNode } from "react";

import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface ClickableLogRowProps {
  /** Whether this row resolves to a known user and should open on click. */
  clickable: boolean;
  onOpen: () => void;
  children: ReactNode;
}

/**
 * Log-table row that opens a player detail dialog when it resolves to a known
 * user; shared by every collector's live task/check history table.
 */
export function ClickableLogRow({ clickable, onOpen, children }: ClickableLogRowProps) {
  return (
    <TableRow
      className={cn(clickable && "cursor-pointer hover:bg-muted/50")}
      onClick={clickable ? onOpen : undefined}
    >
      {children}
    </TableRow>
  );
}

interface ClickableLogCellProps {
  clickable: boolean;
  onOpen: () => void;
  label: ReactNode;
}

/**
 * The name/label cell inside a `ClickableLogRow`. The row's own `onClick` is
 * mouse-only, so this renders a real button when clickable — the only way
 * keyboard users reach it — stopping propagation so the row handler doesn't
 * fire the same open twice.
 */
export function ClickableLogCell({ clickable, onOpen, label }: ClickableLogCellProps) {
  return (
    <TableCell className="font-medium">
      {clickable ? (
        <button
          type="button"
          className="text-primary underline-offset-2 hover:underline"
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
        >
          {label}
        </button>
      ) : (
        label
      )}
    </TableCell>
  );
}
