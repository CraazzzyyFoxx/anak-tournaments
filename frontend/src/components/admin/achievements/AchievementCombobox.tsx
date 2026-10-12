"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import type { AchievementCategory } from "@/types/admin.types";

import type { AchievementRule } from "@/types/admin.types";
import { Combobox, ComboboxCheck } from "@/components/kit/Combobox";
import { CommandGroup, CommandItem } from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";

interface AchievementComboboxProps {
  rules: AchievementRule[];
  value?: number;
  onSelect: (rule: AchievementRule | undefined) => void;
  id?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  allowClear?: boolean;
}

export function AchievementCombobox({
  rules,
  value,
  onSelect,
  id,
  placeholder,
  searchPlaceholder,
  disabled = false,
  allowClear = true,
}: Readonly<AchievementComboboxProps>) {
  const t = useTranslations("adminAchievements");
  const resolvedPlaceholder = placeholder ?? t("common.achievement");
  const resolvedSearchPlaceholder = searchPlaceholder ?? t("condition.searchNodes");
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");

  const selectedRule = useMemo(
    () => rules.find((r) => r.id === value),
    [rules, value],
  );

  const selectedLabel = selectedRule
    ? `${selectedRule.name} (${selectedRule.slug})`
    : resolvedPlaceholder;

  const handleSelect = useCallback(
    (rule: AchievementRule | undefined) => {
      onSelect(rule);
      setOpen(false);
      setSearchValue("");
    },
    [onSelect],
  );

  // Group rules by category for better navigation
  const grouped = useMemo(() => {
    const map: Record<string, AchievementRule[]> = {};
    for (const rule of rules) {
      (map[rule.category] ??= []).push(rule);
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [rules]);

  return (
    <Combobox
      id={id}
      open={open}
      onOpenChange={setOpen}
      label={selectedLabel}
      disabled={disabled}
      searchValue={searchValue}
      onSearchValueChange={setSearchValue}
      searchPlaceholder={resolvedSearchPlaceholder}
      emptyMessage={t("list.empty")}
      clear={
        allowClear && typeof value === "number" && value > 0
          ? {
              label: t("common.clear"),
              value: "clear-achievement-selection",
              onSelect: () => handleSelect(undefined),
            }
          : undefined
      }
    >
      {grouped.map(([category, categoryRules]) => (
        <CommandGroup key={category} heading={t(`common.categoryValues.${category as AchievementCategory}`)} className="[&_[cmdk-group-heading]]:capitalize">
          {categoryRules.map((rule) => (
            <CommandItem
              key={rule.id}
              value={`${rule.name} ${rule.slug} ${rule.category}`}
              onSelect={() => handleSelect(rule)}
            >
              <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
                <span className="truncate">{rule.name}</span>
                <Badge variant="outline" className="shrink-0 text-xs">
                  {rule.slug}
                </Badge>
              </div>
              <ComboboxCheck selected={value === rule.id} />
            </CommandItem>
          ))}
        </CommandGroup>
      ))}
    </Combobox>
  );
}
