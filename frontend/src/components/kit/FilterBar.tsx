"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Check, ChevronLeft, Plus, X } from "lucide-react";
import { useDebounce } from "use-debounce";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from "@/components/ui/command";
import { FilterChip } from "@/components/ui/filter-chip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SearchField } from "@/components/ui/search-field";
import {
  isFilterActive,
  type FilterState,
  type FilterDef,
  type FilterOption,
  type FilterValue
} from "@/components/kit/useFilters";
import { cn } from "@/lib/utils";

export interface FilterBarProps {
  defs: FilterDef[];
  filters: FilterState;
  search?: { placeholder: string; value: string; onChange: (value: string) => void };
  trailing?: ReactNode;
}

/** One active chip: which filter, which value, and how to drop it. */
interface ActiveChip {
  id: string;
  label: string;
  onRemove: () => void;
}

function optionLabel(def: FilterDef, value: string): string {
  if (def.kind === "single" || def.kind === "multi") {
    return def.options.find((option) => option.value === value)?.label ?? value;
  }
  return value;
}

/** The "no value" item of an inline select: Radix forbids an empty item value. */
const INLINE_ALL = "__all__";

type InlineDef = Extract<FilterDef, { kind: "single" }> & { inline: { allLabel: string } };

/**
 * The one filter surface for the admin panel: search + removable chips + a
 * "+ Filter" popover holding everything not yet applied.
 *
 * It replaced both earlier conventions at once — a "Filter by tournament"
 * `<Select>` in the table toolbar and the per-column funnel popovers — so a
 * screen has exactly one place where "narrow this list" lives, and that place
 * writes the URL.
 */
export function FilterBar({
  defs,
  filters,
  search,
  trailing
}: Readonly<FilterBarProps>) {
  const t = useTranslations("kit.actions");
  const [open, setOpen] = useState(false);
  const [pickerKey, setPickerKey] = useState<string | null>(null);
  const [entityQuery, setEntityQuery] = useState("");
  const [debouncedEntityQuery] = useDebounce(entityQuery, 250);
  const [entityResults, setEntityResults] = useState<FilterOption[]>([]);
  /**
   * Labels for entity values, learnt when the user picks one. The URL carries
   * only the id, so after a reload the chip falls back to showing that id
   * rather than inventing a name it has not been told.
   */
  const [entityLabels, setEntityLabels] = useState<Record<string, string>>({});

  /**
   * A filter is offered only when it is a choice: a toggle, a search, or a
   * list with two or more options. An option nobody holds is not offered.
   */
  const offered = defs
    .map((def) =>
      def.kind === "single" || def.kind === "multi"
        ? { ...def, options: def.options.filter((option) => option.count !== 0) }
        : def
    )
    .filter((def) => def.kind === "toggle" || def.kind === "entity" || def.options.length > 1);
  // An inline filter is its own select, so it is neither a chip nor a "+ Filter" entry.
  const inline = offered.filter(
    (def): def is InlineDef => def.kind === "single" && def.inline !== undefined
  );
  const inlineKeys = new Set(inline.map((def) => def.key));
  const available = offered.filter((def) => !inlineKeys.has(def.key));
  const picker = available.find((def) => def.key === pickerKey) ?? null;

  useEffect(() => {
    if (!picker || picker.kind !== "entity") return;
    let cancelled = false;
    void picker.search(debouncedEntityQuery).then((results) => {
      if (!cancelled) setEntityResults(results);
    });
    return () => {
      cancelled = true;
    };
  }, [picker, debouncedEntityQuery]);

  const closePicker = () => {
    setOpen(false);
    setPickerKey(null);
    setEntityQuery("");
    setEntityResults([]);
  };

  const write = (def: FilterDef, value: FilterValue | null) => {
    const dropped = def.resets?.(value) ?? [];
    if (dropped.length === 0) filters.set(def.key, value);
    else filters.setMany({ ...Object.fromEntries(dropped.map((key) => [key, null])), [def.key]: value });
  };

  // Every def, not only the offered ones: a value already in the URL must
  // stay removable even when its filter has no second option to offer.
  const chips: ActiveChip[] = [];
  for (const def of defs) {
    if (inlineKeys.has(def.key)) continue;
    const value = filters.values[def.key];
    if (!isFilterActive(value)) continue;

    if (Array.isArray(value)) {
      for (const item of value) {
        chips.push({
          id: `${def.key}:${item}`,
          label: `${def.label}: ${optionLabel(def, item)}`,
          onRemove: () =>
            write(
              def,
              value.filter((other) => other !== item)
            )
        });
      }
      continue;
    }

    const shown =
      value === true
        ? def.label
        : `${def.label}: ${
            def.kind === "entity"
              ? (entityLabels[`${def.key}:${value}`] ?? String(value))
              : optionLabel(def, String(value))
          }`;
    chips.push({ id: def.key, label: shown, onRemove: () => write(def, null) });
  }

  const selectOption = (def: FilterDef, option: FilterOption) => {
    if (def.kind === "multi") {
      // The picker stays open: every option shows whether it is on, and a
      // click flips just that one.
      const current = filters.values[def.key];
      const list = Array.isArray(current) ? current : [];
      write(
        def,
        list.includes(option.value)
          ? list.filter((value) => value !== option.value)
          : [...list, option.value]
      );
      return;
    }
    if (def.kind === "entity") {
      setEntityLabels((previous) => ({
        ...previous,
        [`${def.key}:${option.value}`]: option.label
      }));
    }
    write(def, option.value);
    closePicker();
  };

  const pickerValue = picker ? filters.values[picker.key] : undefined;
  const isPicked = (option: FilterOption) =>
    Array.isArray(pickerValue) && pickerValue.includes(option.value);

  /** Options for the second popover level. A `toggle` never reaches it. */
  const pickerOptions: FilterOption[] =
    picker === null || picker.kind === "toggle"
      ? []
      : picker.kind === "entity"
        ? entityResults
        : picker.options;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {search ? (
        <SearchField
          containerClassName="w-full sm:w-64"
          label={search.placeholder}
          placeholder={search.placeholder}
          value={search.value}
          onValueChange={search.onChange}
        />
      ) : null}

      {inline.map((def) => {
        const value = filters.values[def.key];
        return (
          <Select
            key={def.key}
            value={typeof value === "string" && value !== "" ? value : INLINE_ALL}
            onValueChange={(next) => write(def, next === INLINE_ALL ? null : next)}
          >
            <SelectTrigger size="sm" aria-label={def.label} className="w-auto min-w-36 gap-2">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={INLINE_ALL}>{def.inline.allLabel}</SelectItem>
              {def.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  <span className="flex items-center gap-2">
                    {option.icon}
                    {option.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      })}

      <div role="group" aria-label={t("activeFilters")} className="flex flex-wrap items-center gap-2">

        {chips.map((chip) => (
          <FilterChip
            key={chip.id}
            active
            aria-label={t("removeFilter", { label: chip.label })}
            onClick={chip.onRemove}
          >
            {chip.label}
            <X aria-hidden className="size-3" />
          </FilterChip>
        ))}

        {available.length > 0 ? (
        <Popover
          open={open}
          onOpenChange={(next) => (next ? setOpen(true) : closePicker())}
        >
          <PopoverTrigger asChild>
            <button type="button" className="aqt-filter-chip" aria-label={t("addFilter")}>
              <Plus aria-hidden className="size-3" />
              {t("filter")}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-0">
            {picker === null ? (
              <Command>
                <CommandInput placeholder={t("filterBy")} />
                <CommandList>
                  <CommandEmpty>{t("noFilters")}</CommandEmpty>
                  <CommandGroup>
                    {available.map((def) => (
                      <CommandItem
                        key={def.key}
                        value={def.label}
                        onSelect={() => {
                          if (def.kind === "toggle") {
                            write(def, true);
                            closePicker();
                            return;
                          }
                          setPickerKey(def.key);
                        }}
                      >
                        {def.label}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            ) : (
              <Command shouldFilter={picker.kind !== "entity"}>
                <div className="flex items-center gap-1 border-b border-border/60 px-2 py-1.5">
                  <button
                    type="button"
                    onClick={() => setPickerKey(null)}
                    aria-label={t("backToFilterList")}
                    className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <ChevronLeft aria-hidden className="size-4" />
                  </button>
                  <span className="text-xs font-medium text-foreground">{picker.label}</span>
                </div>
                <CommandInput
                  placeholder={t("searchPicker", { label: picker.label.toLowerCase() })}
                  value={picker.kind === "entity" ? entityQuery : undefined}
                  onValueChange={picker.kind === "entity" ? setEntityQuery : undefined}
                />
                <CommandList>
                  <CommandEmpty>{t("nothingMatchesShort")}</CommandEmpty>
                  <CommandGroup>
                    {pickerOptions.map((option) => (
                      <CommandItem
                        key={option.value}
                        value={option.label}
                        onSelect={() => selectOption(picker, option)}
                      >
                        {picker.kind === "multi" ? (
                          <Check
                            aria-hidden
                            className={cn("size-4", isPicked(option) ? "opacity-100" : "opacity-0")}
                          />
                        ) : null}
                        {option.icon}
                        <span className="truncate">{option.label}</span>
                        {option.count !== undefined ? (
                          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                            {option.count}
                          </span>
                        ) : null}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            )}
          </PopoverContent>
        </Popover>
        ) : null}

        {chips.length > 1 ? (
          <button
            type="button"
            onClick={filters.clear}
            className={cn(
              "rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors",
              "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            )}
          >
            {t("clearAll")}
          </button>
        ) : null}
      </div>

      {trailing ? <div className="ml-auto flex items-center gap-2">{trailing}</div> : null}
    </div>
  );
}
