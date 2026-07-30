"use client";

import { type ReactNode } from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** Trailing row that resets the selection. Wording differs per domain. */
export interface AdminComboboxClearAction {
  /** Row label, e.g. "Clear selection" or "Set as TBD". */
  label: string;
  /** cmdk search value for the row; keep it unique inside the list. */
  value: string;
  onSelect: () => void;
}

export interface AdminComboboxProps {
  /** Forwarded to the trigger so a `<Label htmlFor>` can point at it. */
  id?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Trigger text — the selected label, or the placeholder when nothing is selected. */
  label: string;
  disabled?: boolean;
  searchValue: string;
  onSearchValueChange: (value: string) => void;
  searchPlaceholder: string;
  /**
   * Accessible name for the search field. Defaults to `searchPlaceholder` — a
   * placeholder alone is not an accessible name, and cmdk's `aria-labelledby`
   * points at a `Command.Label` this primitive does not render.
   */
  searchLabel?: string;
  emptyMessage: ReactNode;
  /** Pass `false` for server-filtered results so cmdk does not filter them again. */
  shouldFilter?: boolean;
  clear?: AdminComboboxClearAction;
  /** `CommandGroup`s holding the options. */
  children: ReactNode;
}

/**
 * Trigger + popover shell shared by every admin combobox. Owns the ARIA
 * contract — the `combobox` trigger wired to the popup it controls, and a real
 * accessible name on the search field — so the domain comboboxes only have to
 * describe their own options.
 */
export function AdminCombobox({
  id,
  open,
  onOpenChange,
  label,
  disabled = false,
  searchValue,
  onSearchValueChange,
  searchPlaceholder,
  searchLabel,
  emptyMessage,
  shouldFilter,
  clear,
  children
}: AdminComboboxProps) {
  // `aria-controls` is supplied by Radix's PopoverTrigger (it points at the
  // content id it also stamps on PopoverContent). Overriding it here would
  // break that link, and cmdk ignores an `id` passed to CommandList.
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          disabled={disabled}
          className="h-10 w-full justify-between border-border/60 bg-background/80 font-normal hover:bg-background/90"
        >
          <span className="truncate" title={label}>
            {label}
          </span>
          <ChevronsUpDown aria-hidden className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
        <Command shouldFilter={shouldFilter}>
          <CommandInput
            value={searchValue}
            onValueChange={onSearchValueChange}
            placeholder={searchPlaceholder}
            aria-label={searchLabel ?? searchPlaceholder}
          />
          <CommandList>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            {children}
            {clear ? (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem value={clear.value} onSelect={clear.onSelect}>
                    {clear.label}
                  </CommandItem>
                </CommandGroup>
              </>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Selection tick for a `CommandItem`; keeps the row height stable when unselected. */
export function AdminComboboxCheck({ selected }: { selected: boolean }) {
  return (
    <Check
      aria-hidden
      className={cn("ml-2 h-4 w-4 shrink-0", selected ? "opacity-100" : "opacity-0")}
    />
  );
}
