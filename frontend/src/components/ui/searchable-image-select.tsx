"use client";

import { useState, type ReactNode } from "react";
import Image from "next/image";
import { Check, ChevronsUpDown } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface SearchableImageOption {
  value: string;
  label: string;
  imageSrc?: string | null;
  icon?: ReactNode;
  /** Optional trailing facet count ("how many rows this option matches"). */
  count?: number;
}

interface SearchableImageSelectBaseProps {
  /** Full list of selectable items. */
  options: SearchableImageOption[];
  /** Placeholder text shown when nothing is selected. */
  placeholder: string;
  /** Clear row's label; defaults to `placeholder`. */
  clearLabel?: string;
  /** Placeholder for the search input inside the popover. */
  searchPlaceholder?: string;
  /** `false` drops the clear row, for pickers that always hold a selection. */
  clearable?: boolean;
  /** Trigger's accessible name; defaults to `placeholder`. */
  ariaLabel?: string;
  /** Whether the selector is in a loading state. */
  isLoading?: boolean;
  /** Whether the selector is disabled (loading or error). */
  disabled?: boolean;
  /** Replaces the trigger's default appearance (border/background); merged over its layout. */
  triggerClassName?: string;
}

/**
 * Single- or multi-select, discriminated by `multiple` so a call site cannot
 * mix the two value shapes. Multi keeps the popover open while toggling —
 * closing after every pick makes a three-item selection a nine-click job.
 */
type SearchableImageSelectProps = SearchableImageSelectBaseProps &
  (
    | {
        multiple?: false;
        /** Currently selected value, or undefined when "all" / cleared. */
        value?: string;
        /** Called with the new value, or undefined when cleared. */
        onValueChange: (nextValue: string | undefined) => void;
      }
    | {
        multiple: true;
        /** Currently selected values; empty means "all" / no filter. */
        values: string[];
        onValuesChange: (nextValues: string[]) => void;
      }
  );

const SearchableImageSelect = (props: SearchableImageSelectProps) => {
  const {
    options,
    placeholder,
    clearLabel,
    searchPlaceholder,
    clearable = true,
    ariaLabel,
    isLoading = false,
    disabled = false,
    triggerClassName
  } = props;
  const t = useTranslations();
  const [open, setOpen] = useState(false);

  const resolvedSearchPlaceholder = searchPlaceholder ?? t("common.search");
  const selectedValues = props.multiple
    ? props.values
    : props.value === undefined
      ? []
      : [props.value];
  const selectedOptions = options.filter((option) => selectedValues.includes(option.value));

  const handleSelect = (nextValue: string | undefined) => {
    if (props.multiple) {
      if (nextValue === undefined) {
        props.onValuesChange([]);
        setOpen(false);
        return;
      }
      props.onValuesChange(
        selectedValues.includes(nextValue)
          ? selectedValues.filter((value) => value !== nextValue)
          : [...selectedValues, nextValue]
      );
      return;
    }
    props.onValueChange(nextValue);
    setOpen(false);
  };

  const triggerLabel = isLoading ? (
    <Skeleton className="h-4 w-28" />
  ) : (
    <span className="truncate">
      {props.multiple || selectedOptions.length !== 1 ? placeholder : selectedOptions[0].label}
    </span>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel ?? placeholder}
          disabled={disabled}
          className={cn(
            "h-8 w-full justify-between font-normal",
            triggerClassName ??
              "border-[color:var(--aqt-border)] bg-[hsl(0_0%_100%/0.02)] text-[color:var(--aqt-fg)] hover:bg-[hsl(0_0%_100%/0.04)]"
          )}
        >
          <div className="flex items-center gap-2 overflow-hidden">
            {/* Single-select renames itself to the pick, so its crest leads the
                label. Multi keeps the facet's own name ("Division") and lets
                the crests trail it. */}
            {props.multiple ? triggerLabel : null}
            <span className={cn("flex items-center", props.multiple ? "-space-x-1.5" : "gap-2")}>
              {selectedOptions.slice(0, 3).map((option) =>
                option.imageSrc ? (
                  <Image
                    key={option.value}
                    src={option.imageSrc}
                    alt=""
                    width={22}
                    height={22}
                    className="h-5.5 w-5.5 shrink-0 select-none object-contain"
                  />
                ) : option.icon ? <span key={option.value}>{option.icon}</span> : null
              )}
            </span>
            {props.multiple ? null : triggerLabel}
            {selectedOptions.length > 3 ? (
              <span className="shrink-0 tabular-nums">+{selectedOptions.length - 3}</span>
            ) : null}
          </div>
          <ChevronsUpDown aria-hidden className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        // Trigger-width, but a compact trigger must not produce a list too
        // narrow to read; the inner min() keeps it inside the viewport.
        className="liquid-glass-panel w-[var(--radix-popover-trigger-width)] min-w-[min(16rem,var(--radix-popover-content-available-width))] p-0"
      >
        <Command className="liquid-glass-surface">
          <CommandInput placeholder={resolvedSearchPlaceholder} />
          <CommandList>
            <CommandEmpty>{t("common.noResults")}</CommandEmpty>
            <CommandGroup>
              {clearable ? (
                <CommandItem
                  value={`__clear__ ${clearLabel ?? placeholder}`}
                  onSelect={() => handleSelect(undefined)}
                >
                  <span>{clearLabel ?? placeholder}</span>
                  <Check
                    aria-hidden
                    className={`ml-auto h-4 w-4 ${selectedValues.length === 0 ? "opacity-100" : "opacity-0"}`}
                  />
                </CommandItem>
              ) : null}
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={`${option.label} ${option.value}`}
                  onSelect={() => handleSelect(option.value)}
                >
                  <div className="flex items-center gap-2">
                    {option.imageSrc ? (
                      <Image
                        src={option.imageSrc}
                        alt=""
                        width={20}
                        height={20}
                        className="h-5 w-5 select-none object-contain"
                      />
                    ) : option.icon ?? null}
                    <span>{option.label}</span>
                  </div>
                  {option.count !== undefined ? (
                    <span className="ml-auto text-label tabular-nums text-[color:var(--aqt-fg-faint)]">
                      {option.count}
                    </span>
                  ) : null}
                  <Check
                    aria-hidden
                    className={cn(
                      "h-4 w-4",
                      option.count === undefined && "ml-auto",
                      selectedValues.includes(option.value) ? "opacity-100" : "opacity-0"
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export default SearchableImageSelect;
