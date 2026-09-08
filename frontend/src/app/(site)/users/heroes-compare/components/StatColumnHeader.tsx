"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { StatColumnDef, StatKey } from "../config/stat-columns";

interface StatColumnHeaderProps {
  def: StatColumnDef;
  options: StatColumnDef[];
  /** True when this column drives the single shared row order of the table. */
  isActive: boolean;
  sortDir: "asc" | "desc";
  onSort: () => void;
  onSelect: (key: StatKey) => void;
}

/**
 * One `<th>` of the hero leaderboard: a sort button whose visible label is its
 * accessible name (state lives in the `aria-sort` this cell carries), plus an
 * icon-only picker that swaps which stat the column shows.
 */
const StatColumnHeader = ({
  def,
  options,
  isActive,
  sortDir,
  onSort,
  onSelect,
}: StatColumnHeaderProps) => {
  const t = useTranslations();
  const label = t(def.labelKey);
  const SortIcon = !isActive ? ArrowUpDown : sortDir === "asc" ? ArrowUp : ArrowDown;

  return (
    <th
      scope="col"
      aria-sort={isActive ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
      className="border-b border-[color:var(--aqt-border)] bg-[hsl(0_0%_100%/0.008)] px-3.5 pb-3 pt-3.5 align-bottom font-normal"
    >
      <div className="flex flex-col items-center gap-2">
        <div aria-hidden className={`h-[3px] w-[34px] rounded-full ${def.accentColor}`} />
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onSort}
            className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-label font-bold uppercase tracking-label text-[color:var(--aqt-fg)] outline-none transition-colors hover:bg-[hsl(0_0%_100%/0.05)] focus-visible:ring-2 focus-visible:ring-[color:var(--aqt-teal)]"
          >
            {label}
            <SortIcon
              aria-hidden
              className={
                isActive
                  ? "h-3 w-3 shrink-0 text-[color:var(--aqt-teal)]"
                  : "h-3 w-3 shrink-0 text-[color:var(--aqt-fg-faint)] opacity-60"
              }
            />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t("users.heroesCompare.table.selectStat", { stat: label })}
                className="inline-flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-md border border-transparent text-[color:var(--aqt-fg-faint)] outline-none transition-colors hover:border-[color:var(--aqt-border-2)] hover:bg-[hsl(0_0%_100%/0.05)] hover:text-[color:var(--aqt-fg)] focus-visible:ring-2 focus-visible:ring-[color:var(--aqt-teal)]"
              >
                <ChevronDown aria-hidden className="h-3 w-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" className="max-h-[340px] w-52 overflow-y-auto">
              {options.map((opt) => (
                <DropdownMenuItem
                  key={opt.key}
                  onSelect={() => onSelect(opt.key)}
                  className={`cursor-pointer gap-2 ${opt.key === def.key ? "bg-[hsl(0_0%_100%/0.06)] font-semibold" : ""}`}
                >
                  <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${opt.accentColor}`} />
                  {t(opt.labelKey)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </th>
  );
};

export default StatColumnHeader;
