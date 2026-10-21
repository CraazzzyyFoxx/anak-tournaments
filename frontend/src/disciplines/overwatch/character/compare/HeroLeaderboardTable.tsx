"use client";

import { useMemo, useState } from "react";
import { EyeOff, Sword } from "lucide-react";
import { useTranslations } from "next-intl";

import CatalogEntityImage from "@/components/catalog/CatalogEntityImage";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { characterClass } from "@/lib/catalog/attrs";
import { cn } from "@/lib/utils";
import type { CatalogEntityRead } from "@/types/catalog.types";

import type { RankedEntry } from "./board";
import BarRow, { CELL, STICKY_PLAYER, STICKY_RANK, type StatCellSpec } from "./BarRow";
import { ALL_STAT_OPTIONS, COL, type StatKey } from "./stat-columns";
import StatColumnHeader from "./StatColumnHeader";

const SKELETON_ROWS = 15;
const TITLE_ID = "hero-leaderboard-title";

const HEAD_CELL = "border-b border-[color:var(--aqt-border)] bg-[color:var(--aqt-card)] px-3 py-2.5 align-middle";
const HEAD_LABEL = "text-label font-bold uppercase tracking-label text-[color:var(--aqt-fg-faint)]";

interface HeroLeaderboardTableProps {
  selectedHero: CatalogEntityRead | undefined;
  selectedTournamentName: string | undefined;
  tournamentId: number | undefined;
  /** Every player at the sample floor, ranked: the bars' scale. */
  ranked: readonly RankedEntry[];
  /** The rows on screen: the search's matches, cut to what the reader asked to see. */
  rows: readonly RankedEntry[];
  /** How many rows the search matches in all. */
  matchCount: number;
  /** Players under the sample floor, left off the board. */
  hiddenCount: number;
  minGames: number;
  query: string;
  isLoading: boolean;
  columnKeys: StatKey[];
  /** Index into `columnKeys` of the column that drives the shared row order. */
  sortIndex: number;
  sortDir: "asc" | "desc";
  /** Rows the next "show more" adds; 0 when every match is on screen. */
  moreCount: number;
  onColumnSelect: (colIndex: number, key: StatKey) => void;
  onSortChange: (colIndex: number) => void;
  onShowMore: () => void;
  onShowHidden: () => void;
}

const HeroLeaderboardTable = ({
  selectedHero,
  selectedTournamentName,
  tournamentId,
  ranked,
  rows,
  matchCount,
  hiddenCount,
  minGames,
  query,
  isLoading,
  columnKeys,
  sortIndex,
  sortDir,
  moreCount,
  onColumnSelect,
  onSortChange,
  onShowMore,
  onShowHidden,
}: HeroLeaderboardTableProps) => {
  const t = useTranslations();
  const [hoveredUserId, setHoveredUserId] = useState<number | null>(null);
  // The class badge wears the character's own catalog colour (neutral without one) — never a role hue.
  const badgeColor = typeof selectedHero?.attrs.color === "string" ? selectedHero.attrs.color : "var(--aqt-fg-muted)";

  // One scale per column over every ranked player (not the rows on screen), so a bar means the same thing
  // whatever the search or the "show more" cut leaves visible.
  const cells = useMemo<StatCellSpec[]>(
    () =>
      columnKeys.map((key) => {
        const def = COL[key];
        return { def, sorted: ranked.map(({ entry }) => def.getValue(entry)).sort((a, b) => a - b) };
      }),
    [columnKeys, ranked]
  );

  const emptyMessage = query
    ? t("users.heroesCompare.table.noMatches", { query: query.trim() })
    : hiddenCount > 0
      ? t("users.heroesCompare.table.allBelowFloor", { min: minGames })
      : tournamentId
        ? t("users.heroesCompare.table.noDataInTournament")
        : t("users.heroesCompare.table.noData");

  return (
    <section className="overflow-hidden rounded-[var(--aqt-radius)] border border-[color:var(--aqt-border)] bg-[color:var(--aqt-card)]">
      {/* Board head */}
      <div className="flex items-center gap-3.5 border-b border-[color:var(--aqt-border)] bg-[color:var(--aqt-overlay-1)] px-5 py-4">
        {selectedHero && <CatalogEntityImage entity={selectedHero} size={44} rounded="lg" />}
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h2
              id={TITLE_ID}
              className="font-[family-name:var(--aqt-display)] text-2xl font-bold uppercase leading-none tracking-[0.03em]"
            >
              {selectedHero?.name ?? t("users.heroesCompare.table.heroFallback")}
            </h2>
            {selectedHero && (
              <span
                className="rounded-[5px] px-1.5 py-0.5 text-label font-bold uppercase leading-none tracking-label"
                style={{
                  color: badgeColor,
                  background: `color-mix(in srgb, ${badgeColor} 15%, transparent)`,
                }}
              >
                {characterClass(selectedHero)}
              </span>
            )}
          </div>
          <p className="mt-1 font-[family-name:var(--aqt-data)] text-label text-[color:var(--aqt-fg-dim)]">
            {selectedTournamentName ?? t("users.heroesCompare.allTournaments")}
            {tournamentId ? ` · ${t("users.heroesCompare.table.scope")} #${tournamentId}` : ""}
          </p>
        </div>
      </div>

      {/* One table, one row order: column k and column k+1 describe the same player. */}
      <div className="overflow-x-auto">
        <table
          aria-labelledby={TITLE_ID}
          aria-busy={isLoading}
          className="w-full min-w-[960px] table-fixed border-separate border-spacing-0"
        >
          <colgroup>
            <col className="w-[52px]" />
            {/* Narrower on a phone: the sticky rank + player pair must leave room for the column scrolling past. */}
            <col className="w-[148px] sm:w-[220px]" />
            <col className="w-[88px]" />
            {columnKeys.map((key, i) => (
              <col key={`${key}-${i}`} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className={cn(HEAD_CELL, STICKY_RANK)}>
                <span className="sr-only">{t("users.heroesCompare.table.rank")}</span>
              </th>
              <th scope="col" className={cn(HEAD_CELL, STICKY_PLAYER, HEAD_LABEL, "text-left")}>
                {t("users.heroesCompare.table.player")}
              </th>
              <th scope="col" className={cn(HEAD_CELL, HEAD_LABEL, "text-right")}>
                {t("users.heroesCompare.table.games")}
              </th>
              {columnKeys.map((key, i) => (
                <StatColumnHeader
                  key={`${key}-${i}`}
                  def={COL[key]}
                  options={ALL_STAT_OPTIONS}
                  isActive={i === sortIndex}
                  sortDir={sortDir}
                  onSort={() => onSortChange(i)}
                  onSelect={(k) => onColumnSelect(i, k)}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: SKELETON_ROWS }).map((_, r) => (
                <tr key={r}>
                  {Array.from({ length: columnKeys.length + 3 }).map((__, c) => (
                    <td key={c} className={CELL}>
                      <Skeleton className="h-4 w-full" />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columnKeys.length + 3}
                  className="py-[90px] text-center text-sm text-[color:var(--aqt-fg-dim)]"
                >
                  <span className="inline-flex items-center gap-2">
                    <Sword aria-hidden className="h-4 w-4 opacity-40" />
                    {emptyMessage}
                  </span>
                </td>
              </tr>
            ) : (
              rows.map((entry) => (
                <BarRow
                  key={entry.entry.user_id}
                  ranked={entry}
                  cells={cells}
                  activeIndex={sortIndex}
                  isHighlighted={entry.entry.user_id === hoveredUserId}
                  onHoverUser={setHoveredUserId}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {!isLoading && (rows.length > 0 || hiddenCount > 0) ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 text-caption text-[color:var(--aqt-fg-dim)]">
          {hiddenCount > 0 ? (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <EyeOff aria-hidden className="size-3.5 shrink-0 text-[color:var(--aqt-fg-faint)]" />
              {t("users.heroesCompare.table.belowFloor", { count: hiddenCount, min: minGames })}
              <button
                type="button"
                onClick={onShowHidden}
                className="rounded font-semibold text-[color:var(--aqt-teal)] underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[color:var(--aqt-teal)]"
              >
                {t("users.heroesCompare.table.showBelowFloor")}
              </button>
            </p>
          ) : null}
          {rows.length > 0 ? (
            <span className="ml-auto tabular-nums">
              {t("users.heroesCompare.table.showing", { shown: rows.length, total: matchCount })}
            </span>
          ) : null}
          {moreCount > 0 ? (
            <Button type="button" variant="outline" size="sm" onClick={onShowMore}>
              {t("users.heroesCompare.table.showMore", { count: moreCount })}
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
};

export default HeroLeaderboardTable;
