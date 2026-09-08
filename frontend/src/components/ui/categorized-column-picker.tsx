"use client";

import type { ReactNode } from "react";

import { Settings2 } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** Minimal column shape the picker needs to group and toggle columns. */
export interface CategorizedColumn<TCategory extends string = string> {
  id: string;
  label: ReactNode;
  category: TCategory;
}

export interface CategorizedColumnPickerProps<
  TCategory extends string,
  TColumn extends CategorizedColumn<TCategory>,
> {
  columns: readonly TColumn[];
  /** Category display order; a category with no columns is skipped. */
  categories: readonly TCategory[];
  categoryLabel: (category: TCategory) => string;
  visibility: Record<string, boolean>;
  onToggle: (id: string) => void;
  onReset: () => void;
  triggerLabel: string;
  resetLabel: string;
  /** Columns that can't be hidden — rendered checked, disabled, non-interactive. */
  isMandatory?: (id: string) => boolean;
}

/**
 * "Columns" popover shared by every table that lets users show/hide columns
 * grouped by category (tournament participants, balancer registrations).
 * Visibility persistence (URL state, localStorage, or both) is the caller's
 * concern — this component only renders the picker UI.
 */
export function CategorizedColumnPicker<
  TCategory extends string,
  TColumn extends CategorizedColumn<TCategory>,
>({
  columns,
  categories,
  categoryLabel,
  visibility,
  onToggle,
  onReset,
  triggerLabel,
  resetLabel,
  isMandatory,
}: Readonly<CategorizedColumnPickerProps<TCategory, TColumn>>) {
  const groups = new Map<TCategory, TColumn[]>();
  for (const column of columns) {
    const list = groups.get(column.category) ?? [];
    list.push(column);
    groups.set(column.category, list);
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-8 items-center gap-1.5 rounded-lg border border-[color:var(--aqt-border-2)] bg-[color:var(--aqt-overlay-2)] px-3 text-xs text-[color:var(--aqt-fg-muted)] outline-none transition-colors hover:bg-[color:var(--aqt-overlay-3)] hover:text-[color:var(--aqt-fg)] focus-visible:ring-2 focus-visible:ring-[color:var(--aqt-teal)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--aqt-bg)]"
        >
          <Settings2 className="size-3.5" aria-hidden />
          {triggerLabel}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-3">
        <div className="space-y-3">
          {categories.map((category) => {
            const items = groups.get(category);
            if (!items || items.length === 0) return null;

            return (
              <div key={category}>
                <p className="mb-1.5 text-label font-semibold uppercase tracking-wider text-[color:var(--aqt-fg-dim)]">
                  {categoryLabel(category)}
                </p>
                <div className="space-y-1">
                  {items.map((column) => {
                    const mandatory = isMandatory?.(column.id) ?? false;
                    return (
                      <label
                        key={column.id}
                        className={
                          mandatory
                            ? "flex cursor-not-allowed items-center gap-2 rounded px-1 py-0.5 text-xs text-[color:var(--aqt-fg-dim)]"
                            : "flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs text-[color:var(--aqt-fg-muted)] hover:bg-[color:var(--aqt-overlay-3)] hover:text-[color:var(--aqt-fg)]"
                        }
                      >
                        <Checkbox
                          checked={mandatory || visibility[column.id] !== false}
                          disabled={mandatory}
                          onCheckedChange={() => {
                            if (!mandatory) onToggle(column.id);
                          }}
                        />
                        {column.label}
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}

          <button
            type="button"
            onClick={onReset}
            className="w-full rounded px-2 py-1 text-label text-[color:var(--aqt-fg-dim)] outline-none transition-colors hover:bg-[color:var(--aqt-overlay-3)] hover:text-[color:var(--aqt-fg-muted)] focus-visible:ring-2 focus-visible:ring-[color:var(--aqt-teal)]"
          >
            {resetLabel}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
