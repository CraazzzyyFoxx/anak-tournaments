"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { StatColumnDef, StatKey } from "./stat-columns";

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
 * icon-only picker that swaps which stat the column shows. The column that
 * orders the board is the one in the accent; every other column stays neutral.
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
      className={cn(
        "border-b border-[color:var(--aqt-border)] px-2 py-2.5 align-middle font-normal",
        isActive
          ? "bg-[color:var(--aqt-overlay-1)] shadow-[inset_0_-2px_0_var(--aqt-teal)]"
          : "bg-[color:var(--aqt-card)]"
      )}
    >
      <div className="flex items-center justify-center gap-1">
        <button
          type="button"
          onClick={onSort}
          className={cn(
            "flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-label font-bold uppercase tracking-label outline-none transition-colors hover:bg-[color:var(--aqt-overlay-3)] focus-visible:ring-2 focus-visible:ring-[color:var(--aqt-teal)]",
            isActive ? "text-[color:var(--aqt-teal)]" : "text-[color:var(--aqt-fg-muted)] hover:text-[color:var(--aqt-fg)]"
          )}
        >
          <span className="flex flex-col items-center">
            {/* A narrow column splits "Final blows / 10" into two even lines, never leaving "10" alone. */}
            <span className="text-balance">{label}</span>
            {def.ascending ? (
              <span className="font-medium normal-case tracking-normal text-[color:var(--aqt-fg-faint)]">
                {t("users.heroesCompare.table.lowerIsBetter")}
              </span>
            ) : null}
          </span>
          <SortIcon
            aria-hidden
            className={isActive ? "h-3 w-3 shrink-0" : "h-3 w-3 shrink-0 text-[color:var(--aqt-fg-faint)] opacity-60"}
          />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t("users.heroesCompare.table.selectStat", { stat: label })}
              className="inline-flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-md border border-transparent text-[color:var(--aqt-fg-faint)] outline-none transition-colors hover:border-[color:var(--aqt-border-2)] hover:bg-[color:var(--aqt-overlay-3)] hover:text-[color:var(--aqt-fg)] focus-visible:ring-2 focus-visible:ring-[color:var(--aqt-teal)]"
            >
              <ChevronDown aria-hidden className="h-3 w-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" className="max-h-[340px] w-52 overflow-y-auto">
            {options.map((opt) => (
              <DropdownMenuItem
                key={opt.key}
                onSelect={() => onSelect(opt.key)}
                className={cn("cursor-pointer", opt.key === def.key && "bg-[color:var(--aqt-overlay-3)] font-semibold")}
              >
                {t(opt.labelKey)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </th>
  );
};

export default StatColumnHeader;
