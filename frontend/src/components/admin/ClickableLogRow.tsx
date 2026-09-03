"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface ClickableLogRowProps {
  /** Where the row resolves to, or `null` when it names no known person. */
  href: string | null;
  children: ReactNode;
}

/**
 * Log-table row that opens the person it resolved to; shared by every
 * collector's live task/check history table.
 *
 * The row's own `onClick` is a mouse convenience — the real affordance is the
 * link in `ClickableLogCell`, which is what a keyboard, a middle click and a
 * screen reader all see.
 */
export function ClickableLogRow({ href, children }: Readonly<ClickableLogRowProps>) {
  const router = useRouter();
  return (
    <TableRow
      className={cn(href && "cursor-pointer hover:bg-muted/50")}
      onClick={href ? () => router.push(href) : undefined}
    >
      {children}
    </TableRow>
  );
}

interface ClickableLogCellProps {
  href: string | null;
  label: ReactNode;
}

/**
 * The name/label cell inside a `ClickableLogRow`. A real link, so the row is
 * reachable without a mouse and openable in a new tab; the click is stopped
 * from bubbling so the row handler does not navigate a second time.
 */
export function ClickableLogCell({ href, label }: Readonly<ClickableLogCellProps>) {
  return (
    <TableCell className="font-medium">
      {href ? (
        <Link
          href={href}
          className="text-primary underline-offset-2 hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          {label}
        </Link>
      ) : (
        label
      )}
    </TableCell>
  );
}
