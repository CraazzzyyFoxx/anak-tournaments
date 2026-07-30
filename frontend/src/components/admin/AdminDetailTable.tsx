"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { EYEBROW_CLASS } from "@/components/admin/tone";

export type AdminDetailTableVariant = "compact" | "comfortable";

type AdminDetailTableStyles = {
  shell: string;
  headerRow: string;
  head: string;
  row: string;
  cell: string;
  /** `cell` plus `tabular-nums`, so numeric columns line up. */
  numericCell: string;
};

const COMPACT_CELL = "py-2 text-sm first:pl-3 last:pr-3 align-middle";
const COMFORTABLE_CELL = "py-3.5 first:pl-4 last:pr-4";

const STYLES: Record<AdminDetailTableVariant, AdminDetailTableStyles> = {
  compact: {
    shell: "overflow-hidden rounded-lg border border-border/40",
    headerRow: "hover:bg-transparent",
    head: "sticky top-0 z-10 h-8 bg-muted/20 text-xs font-medium text-muted-foreground first:pl-3 last:pr-3",
    row: "border-b border-border/30 transition-colors hover:bg-accent/20",
    cell: COMPACT_CELL,
    numericCell: `${COMPACT_CELL} tabular-nums`
  },
  comfortable: {
    shell: "overflow-hidden rounded-xl border border-border/60 bg-background/40",
    headerRow: "border-border/60 hover:bg-transparent",
    head: `h-11 bg-muted/15 ${EYEBROW_CLASS} first:pl-4 last:pr-4`,
    row: "border-border/50 transition-colors duration-200 hover:bg-muted/20",
    cell: COMFORTABLE_CELL,
    numericCell: `${COMFORTABLE_CELL} tabular-nums`
  }
};

export function getAdminDetailTableStyles(
  variant: AdminDetailTableVariant = "compact"
): AdminDetailTableStyles {
  return STYLES[variant];
}

interface AdminDetailTableShellProps {
  children: ReactNode;
  className?: string;
  variant?: AdminDetailTableVariant;
}

export function AdminDetailTableShell({
  children,
  className,
  variant = "compact",
}: AdminDetailTableShellProps) {
  return <div className={cn(STYLES[variant].shell, className)}>{children}</div>;
}
