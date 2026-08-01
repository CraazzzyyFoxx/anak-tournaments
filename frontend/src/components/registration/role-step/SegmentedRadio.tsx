"use client";

import { useRef } from "react";

import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Extra classes applied when this option is the selected one. */
  selectedClassName?: string;
}

interface SegmentedRadioProps<T extends string> {
  /** Names the group for assistive technology — the row's role, e.g. "Tank priority". */
  label: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
}

/**
 * Segmented single-choice control following the ARIA radiogroup pattern.
 *
 * The role cards it replaces were plain `<button>`s with no `aria-checked`, so
 * the selection was conveyed by border color alone and the group had no keyboard
 * model. Here the checked option is the only tab stop and arrows move within.
 */
export function SegmentedRadio<T extends string>({
  label,
  value,
  options,
  onChange,
}: SegmentedRadioProps<T>) {
  const groupRef = useRef<HTMLDivElement>(null);

  const move = (delta: number) => {
    const index = options.findIndex((option) => option.value === value);
    const next = options[(index + delta + options.length) % options.length];
    onChange(next.value);
    const buttons = groupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    buttons?.[options.indexOf(next)]?.focus();
  };

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={label}
      className="inline-flex w-full rounded-lg border border-[color:var(--aqt-border-2)] bg-[color:var(--aqt-overlay-1)] p-0.5"
    >
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                event.preventDefault();
                move(1);
              } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                event.preventDefault();
                move(-1);
              }
            }}
            className={cn(
              "flex-1 whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
              checked
                ? cn("text-[color:var(--aqt-fg)]", option.selectedClassName ?? "bg-[color:var(--aqt-overlay-3)]")
                : "text-[color:var(--aqt-fg-muted)] hover:bg-[color:var(--aqt-overlay-2)]",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
