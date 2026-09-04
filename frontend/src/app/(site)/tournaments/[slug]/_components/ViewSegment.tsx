"use client";

import type { ReactNode } from "react";

import { useQueryParams } from "@/hooks/useQueryParams";
import { cn } from "@/lib/utils";

export type ViewSegmentOption<V extends string> = {
  value: V;
  label: ReactNode;
  /** Optional accessible name when `label` is an icon. */
  ariaLabel?: string;
};

export type ViewSegmentProps<V extends string> = {
  /** URL parameter this segment writes; `view` for section views, `tab` for sub-tabs. */
  param: string;
  options: readonly ViewSegmentOption<V>[];
  /** Value in effect when the URL carries none (the default is never written). */
  defaultValue: V;
  /** Called after the URL changes, for a secondary store such as `localStorage`. */
  onChange?: (value: V) => void;
  label: string;
  /** Hidden below `sm` — narrow screens get the default view only. */
  hideOnMobile?: boolean;
  className?: string;
};

/**
 * A segmented switch between views of one section, bound to a URL parameter.
 * The default value is never written, so the canonical URL stays clean and a
 * link with no `?view=` means "the default".
 */
export function ViewSegment<V extends string>({
  param,
  options,
  defaultValue,
  onChange,
  label,
  hideOnMobile = true,
  className
}: Readonly<ViewSegmentProps<V>>) {
  const { searchParams, setParams } = useQueryParams({ resetOnChange: [] });
  const raw = searchParams?.get(param);
  const current = (options.find((o) => o.value === raw)?.value ?? defaultValue) as V;

  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        "inline-flex overflow-hidden rounded-md border border-[color:var(--aqt-border)] text-xs",
        hideOnMobile && "hidden sm:inline-flex",
        className
      )}
    >
      {options.map((option) => {
        const selected = option.value === current;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-label={option.ariaLabel}
            className={cn(
              "px-2.5 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--aqt-teal)]",
              selected
                ? "bg-[color:var(--aqt-overlay-3)] text-[color:var(--aqt-fg)]"
                : "text-[color:var(--aqt-fg-muted)] hover:text-[color:var(--aqt-fg)]"
            )}
            onClick={() => {
              setParams({ [param]: option.value === defaultValue ? null : option.value });
              onChange?.(option.value);
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Read the current value of a `ViewSegment` param outside the component. */
export function readViewParam<V extends string>(
  searchParams: { get(name: string): string | null } | null,
  param: string,
  options: readonly V[],
  defaultValue: V
): V {
  const raw = searchParams?.get(param);
  return (options as readonly string[]).includes(raw ?? "") ? (raw as V) : defaultValue;
}
