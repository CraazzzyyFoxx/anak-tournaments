"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

/**
 * Windowed page list: first, last, the current page and one neighbour each
 * side, with `null` marking an elision. Replaces three ad-hoc versions — one
 * that rendered *every* page (unbounded flex row, guaranteed overflow) and one
 * that rendered only pages 1–3 (so past page 3 no button was ever marked
 * current and mid-range pages were unreachable in one click).
 */
export function buildPageWindow(current: number, total: number): (number | null)[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  // Always keep the first and last page reachable, plus a three-wide window
  // around the current one, widened at the ends so the control never shrinks
  // below five numeric targets.
  const start = Math.min(Math.max(current - 1, 2), total - 4);
  const window = [1, start, start + 1, start + 2, start + 3, total];

  const out: (number | null)[] = [];
  let prev = 0;
  for (const page of window) {
    if (page <= prev || page < 1 || page > total) continue;
    if (prev && page - prev > 1) out.push(null);
    out.push(page);
    prev = page;
  }
  return out;
}

interface DataPaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
  /** Optional "Showing 1–20 of 340" style summary rendered before the controls. */
  summary?: React.ReactNode;
}

const buttonClass =
  "aqt-mono inline-flex h-8 min-w-8 items-center justify-center rounded-[6px] border px-2 text-[13px] tabular-nums transition-colors outline-none " +
  "focus-visible:ring-2 focus-visible:ring-[color:var(--aqt-teal)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--aqt-bg)] " +
  "disabled:cursor-not-allowed disabled:opacity-40";

/**
 * The single pagination control for the public site. Replaces five
 * implementations that between them lost `aria-label` on the arrows,
 * `aria-current` on the active page, and used bare `‹`/`›`/`←`/`→` glyphs
 * (which screen readers read literally) instead of icons.
 */
export function DataPagination({
  page,
  totalPages,
  onPageChange,
  className,
  summary
}: Readonly<DataPaginationProps>) {
  const t = useTranslations();

  const hasControls = totalPages > 1;
  if (!hasControls && !summary) return null;

  // One shell for both branches. These used to diverge: with a single page the
  // component returned a bare `<div className={className}>{summary}</div>`, so
  // the summary lost the size and muted color it gets alongside the page
  // buttons and rendered as full-size default text flush against the card edge.
  const Shell = hasControls ? "nav" : "div";
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const pageWindow = hasControls ? buildPageWindow(safePage, totalPages) : [];

  return (
    <Shell
      aria-label={hasControls ? t("common.pagination.label") : undefined}
      className={cn("flex flex-wrap items-center justify-between gap-3", className)}
    >
      {summary ? (
        <div className="text-[12px] text-[color:var(--aqt-fg-dim)]">{summary}</div>
      ) : (
        <span />
      )}
      {hasControls ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            className={cn(
              buttonClass,
              "border-[color:var(--aqt-border)] text-[color:var(--aqt-fg-muted)] hover:enabled:text-[color:var(--aqt-fg)]"
            )}
            disabled={safePage <= 1}
            aria-label={t("common.pagination.previous")}
            onClick={() => onPageChange(safePage - 1)}
          >
            <ChevronLeft aria-hidden className="size-4" />
          </button>

          {pageWindow.map((entry, index) =>
            entry === null ? (
              <span
                key={`gap-${index}`}
                aria-hidden
                className="px-1 text-[13px] text-[color:var(--aqt-fg-faint)]"
              >
                &hellip;
              </span>
            ) : (
              <button
                key={entry}
                type="button"
                aria-current={entry === safePage ? "page" : undefined}
                aria-label={t("common.pagination.goToPage", { page: entry })}
                className={cn(
                  buttonClass,
                  entry === safePage
                    ? "border-[color:color-mix(in_srgb,var(--aqt-teal)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--aqt-teal)_12%,transparent)] text-[color:var(--aqt-teal)]"
                    : "border-[color:var(--aqt-border)] text-[color:var(--aqt-fg-muted)] hover:text-[color:var(--aqt-fg)]"
                )}
                onClick={() => onPageChange(entry)}
              >
                {entry}
              </button>
            )
          )}

          <button
            type="button"
            className={cn(
              buttonClass,
              "border-[color:var(--aqt-border)] text-[color:var(--aqt-fg-muted)] hover:enabled:text-[color:var(--aqt-fg)]"
            )}
            disabled={safePage >= totalPages}
            aria-label={t("common.pagination.next")}
            onClick={() => onPageChange(safePage + 1)}
          >
            <ChevronRight aria-hidden className="size-4" />
          </button>
        </div>
      ) : null}
    </Shell>
  );
}
