"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import SearchableImageSelect from "@/components/ui/searchable-image-select";
import { useDivisionGrid } from "@/hooks/useCurrentWorkspace";
import { type DivisionGridLike, sortTiersDescending } from "@/lib/divisions/grid";

interface DivisionComboboxProps {
  /** Selected division number, or `undefined` for "any". */
  value?: number;
  onValueChange: (division: number | undefined) => void;
  /** Grid to list; defaults to the current workspace's. Pass the tournament's
   *  grid, or the reference grid for cross-workspace reads. */
  grid?: DivisionGridLike;
  /** Empty-state text and the clear row's label; defaults to "Any". */
  placeholder?: string;
  /** `false` drops the clear row, for pickers that always hold a division. */
  clearable?: boolean;
  ariaLabel?: string;
  disabled?: boolean;
  triggerClassName?: string;
}

/**
 * Searchable single-division picker. Tiers come from a division grid, best
 * first by `rank_min`: grids number their tiers in either direction, so the
 * number alone does not say which end is the top.
 */
export function DivisionCombobox({
  value,
  onValueChange,
  grid,
  placeholder,
  clearable,
  ariaLabel,
  disabled,
  triggerClassName
}: Readonly<DivisionComboboxProps>) {
  const t = useTranslations();
  const workspaceGrid = useDivisionGrid();
  const resolvedGrid = grid ?? workspaceGrid;

  const options = useMemo(
    () =>
      sortTiersDescending(resolvedGrid).map((tier) => ({
        value: String(tier.number),
        label: tier.name,
        imageSrc: tier.icon_url
      })),
    [resolvedGrid]
  );

  return (
    <SearchableImageSelect
      value={value === undefined ? undefined : String(value)}
      onValueChange={(raw) => onValueChange(raw === undefined ? undefined : Number(raw))}
      options={options}
      placeholder={placeholder ?? t("common.any")}
      searchPlaceholder={t("common.searchDivision")}
      clearable={clearable}
      ariaLabel={ariaLabel}
      disabled={disabled}
      triggerClassName={triggerClassName}
    />
  );
}
