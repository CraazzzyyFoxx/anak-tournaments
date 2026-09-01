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
      <PopoverContent align="start" className="w-56 p-0">
        <Command>
          {searchable ? <CommandInput placeholder={label} /> : null}
          <CommandList>
            <CommandEmpty>No options match.</CommandEmpty>
            <CommandGroup>
              {spec.options.map((option) => {
                const checked = selected.includes(option.value);
                return (
                  <CommandItem
                    key={option.value}
                    value={option.label}
                    aria-selected={checked}
                    onSelect={() => onChange(toggleFilterValue(filters, spec, option.value))}
                    className="gap-2"
                  >
                    <Check
                      aria-hidden
                      className={cn("size-3.5 shrink-0", checked ? "opacity-100" : "opacity-0")}
                    />
                    <span className="flex-1 truncate">{option.label}</span>
                    {option.count != null ? (
                      <span className="text-[11px] tabular-nums text-muted-foreground">
                        {option.count}
                      </span>
                    ) : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
        {selected.length > 0 ? (
          <div className="border-t border-border/50 p-1">
            <button
              type="button"
              onClick={() => {
                const next = { ...filters };
                delete next[spec.param];
                onChange(next);
              }}
              className="w-full rounded px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent/30 hover:text-foreground"
            >
              Clear filter
            </button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
