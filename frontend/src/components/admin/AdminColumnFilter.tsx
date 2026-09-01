"use client";

import { useState } from "react";
import { Check, Funnel } from "lucide-react";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  toggleFilterValue,
  type AdminColumnFilterSpec,
  type AdminTableFilters
} from "@/components/admin/admin-table-filters";

const SEARCHABLE_OPTION_THRESHOLD = 8;

/**
 * The funnel next to a column's sort control: a popover of the column's
 * declared options, checked ones applied as query params.
 *
 * It sits beside the sort button rather than wrapping it, so "sort by this
 * column" and "filter this column" stay two separate click targets — the same
 * split antd's table header uses.
 *
 * Density is deliberately tighter than the shared `Command` defaults, which
 * size their rows for a full-screen palette (`min-h-11`). A header filter is a
 * glanceable list of a handful of values, and at palette size eight statuses
 * no longer fit on screen under the header they belong to.
 */
export function AdminColumnFilter({
  spec,
  filters,
  onChange
}: Readonly<{
  spec: AdminColumnFilterSpec;
  filters: AdminTableFilters;
  onChange: (next: AdminTableFilters) => void;
}>) {
  const [open, setOpen] = useState(false);
  const selected = filters[spec.param] ?? [];
  const label = spec.label ?? `Filter by ${spec.param.replace(/_/g, " ")}`;
  const searchable = spec.searchable ?? spec.options.length > SEARCHABLE_OPTION_THRESHOLD;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={selected.length > 0 ? `${label} (${selected.length} applied)` : label}
          aria-expanded={open}
          className={cn(
            "inline-flex size-5 shrink-0 items-center justify-center rounded transition-colors",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            selected.length > 0
              ? "text-foreground"
              : "text-muted-foreground/50 hover:text-foreground"
          )}
        >
          <Funnel
            aria-hidden
            className={cn("size-3", selected.length > 0 && "fill-current")}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-52 overflow-hidden p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-2 py-1.5">
          <span className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </span>
          {selected.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                const next = { ...filters };
                delete next[spec.param];
                onChange(next);
              }}
              className="shrink-0 rounded px-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              Clear
            </button>
          ) : null}
        </div>
        <Command className="bg-transparent">
          {searchable ? (
            <CommandInput
              placeholder="Search…"
              className="h-8 text-xs placeholder:text-muted-foreground"
            />
          ) : null}
          <CommandList className="max-h-64 py-1">
            <CommandEmpty className="py-3 text-center text-xs text-muted-foreground">
              No options match.
            </CommandEmpty>
            <CommandGroup className="p-0">
              {spec.options.map((option) => {
                const checked = selected.includes(option.value);
                return (
                  <CommandItem
                    key={option.value}
                    value={option.label}
                    aria-selected={checked}
                    onSelect={() => onChange(toggleFilterValue(filters, spec, option.value))}
                    // CommandItem sizes its icons for a full-screen palette
                    // (`[&_svg]:size-4`); tailwind-merge lets the later class win, and
                    // the tick has to fit a 14px box.
                    className="mx-1 min-h-0 gap-2 rounded px-1.5 py-1 text-xs [&_svg]:size-2.5"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border transition-colors",
                        checked
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border/70"
                      )}
                    >
                      {checked ? <Check className="size-2.5" /> : null}
                    </span>
                    <span className="flex-1 truncate">{option.label}</span>
                    {option.count != null ? (
                      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                        {option.count}
                      </span>
                    ) : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
