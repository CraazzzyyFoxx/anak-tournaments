"use client";

import { cn } from "@/lib/utils";

export interface AdminFilterChipOption<T extends string> {
  value: T;
  label: string;
  /** Matching rows, when the scope already knows the number. */
  count?: number | null;
}

/**
 * The admin's mutually exclusive filter row.
 *
 * One labelled `role="group"` around real `<button>`s, so a screen reader
 * announces the group once and `aria-pressed` carries which filter is on. The
 * two browsers that needed this had each hand-rolled the same loop with a
 * `ghost` button for the inactive state, which drew a filter as bare text —
 * indistinguishable from the prose beside it, and the only cue that the
 * selected one was selected was its fill.
 */
export function AdminFilterChips<T extends string>({
  label,
  options,
  value,
  onChange,
  className
}: Readonly<{
  /** Names the group for assistive tech, e.g. "Filter captain reports". */
  label: string;
  options: readonly AdminFilterChipOption<T>[];
  value: T;
  onChange: (next: T) => void;
  className?: string;
}>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("flex flex-wrap items-center gap-1.5", className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              active
                ? "border-border bg-accent/40 text-foreground"
                : "border-border/50 bg-muted/20 text-muted-foreground hover:bg-accent/20 hover:text-foreground"
            )}
          >
            {option.label}
            {option.count != null ? (
              <span className="text-[11px] tabular-nums opacity-70">{option.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
