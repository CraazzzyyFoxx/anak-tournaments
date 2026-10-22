"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { CharacterCompareProps } from "@/disciplines/types";
import { characterClass } from "@/lib/catalog/attrs";

import { rankEntries, searchEntries } from "./board";
import HeroCard from "./HeroCard";
import HeroLeaderboardTable from "./HeroLeaderboardTable";
import { COL, NUM_COLUMNS, getDefaultColumnKeys, getSignatureKey, type StatKey } from "./stat-columns";
import TopChart from "./TopChart";
import { useCharacterLeaderboard } from "./useCharacterLeaderboard";

/** Rows on screen at first, and how many each "show more" adds. */
const PAGE_SIZE = 25;
/** The board's own URL state; "Reset columns" drops all of it. */
const BOARD_PARAMS = [...Array.from({ length: NUM_COLUMNS }, (_, i) => `col${i}`), "sort", "dir"];

/**
 * Overwatch's character comparison board (the `characterCompare` slot): the hero card and the top-10 chart over a
 * table with the fixed per-10 column catalog, the hero class's default columns, five user-picked columns and one
 * shared sort, all kept in the URL (`col0..4`, `sort`, `dir`). Without `?sort=` the board is ordered by the class's
 * signature stat. The host's sample floor decides who is ranked; the name search narrows the rows without
 * renumbering them.
 */
const CharacterCompare = (props: CharacterCompareProps) => {
  const { character, tournamentId, metadata, minGames, onMinGamesChange } = props;
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { rows, grids, isLoading } = useCharacterLeaderboard(props);
  // A transient "find me" filter over the loaded board: local, not worth a history entry per keystroke.
  const [query, setQuery] = useState("");

  const updateParams = (updates: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) params.delete(key);
      else params.set(key, String(value));
    }
    router.replace(`${pathname}?${params.toString()}`);
  };

  const heroClass = characterClass(character);
  const defaultKeys = useMemo(() => getDefaultColumnKeys(heroClass), [heroClass]);

  // Memoized so the table's per-column scales and its memoized rows stay
  // stable across renders that only change hover state.
  const columnKeys = useMemo<StatKey[]>(
    () =>
      Array.from({ length: NUM_COLUMNS }, (_, i) => {
        const v = searchParams.get(`col${i}`);
        return v && COL[v] ? v : (defaultKeys[i] ?? defaultKeys[0]);
      }),
    [searchParams, defaultKeys]
  );

  // A single active column drives the shared row order of the whole board: `?sort=`, else the column showing the
  // class's signature stat (the first one once the reader has swapped that stat out).
  const sortParam = searchParams.get("sort");
  const rawSortIndex = sortParam === null ? Number.NaN : Number(sortParam);
  const sortIndex =
    Number.isInteger(rawSortIndex) && rawSortIndex >= 0 && rawSortIndex < NUM_COLUMNS
      ? rawSortIndex
      : Math.max(columnKeys.indexOf(getSignatureKey(heroClass)), 0);

  const dirParam = searchParams.get("dir");
  const naturalDir = (key: StatKey) => ((COL[key]?.ascending ?? false) ? "asc" : "desc");
  const sortDir: "asc" | "desc" = dirParam === "asc" || dirParam === "desc" ? dirParam : naturalDir(columnKeys[sortIndex]);
  const sortDef = COL[columnKeys[sortIndex]];

  const ranked = useMemo(() => rankEntries(rows, minGames, sortDef, sortDir), [rows, minGames, sortDef, sortDir]);
  const matches = useMemo(() => searchEntries(ranked, query), [ranked, query]);

  // Rows a reader asked to see last as long as the board they asked on: another hero, scope, floor or search
  // starts from the first page again; a re-sort keeps the depth.
  const boardKey = `${character?.id}|${tournamentId}|${minGames}|${query}`;
  const [shown, setShown] = useState({ boardKey, count: PAGE_SIZE });
  const count = shown.boardKey === boardKey ? shown.count : PAGE_SIZE;

  const handleColumnSelect = (colIndex: number, key: StatKey) => {
    // Swapping the stat the sorted column shows resets to that stat's natural direction.
    updateParams({ [`col${colIndex}`]: key, ...(colIndex === sortIndex ? { dir: naturalDir(key) } : {}) });
  };

  const handleSortChange = (colIndex: number) => {
    if (colIndex === sortIndex) {
      updateParams({ dir: sortDir === "asc" ? "desc" : "asc" });
      return;
    }
    updateParams({ sort: colIndex, dir: naturalDir(columnKeys[colIndex]) });
  };

  return (
    <div className="space-y-[22px]">
      {character ? (
        <div className="grid gap-[22px] lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <HeroCard
            character={character}
            metadata={metadata}
            rows={rows}
            ranked={ranked}
            minGames={minGames}
            columnKeys={columnKeys}
            sortIndex={sortIndex}
            onSortChange={handleSortChange}
          />
          <TopChart def={sortDef} ranked={ranked} minGames={minGames} isLoading={isLoading} />
        </div>
      ) : null}
      <HeroLeaderboardTable
        discipline={metadata.discipline.code}
        tournamentId={tournamentId}
        ranked={ranked}
        rows={matches.slice(0, count)}
        matchCount={matches.length}
        hiddenCount={rows.length - ranked.length}
        minGames={minGames}
        grids={grids}
        query={query}
        onQueryChange={setQuery}
        isLoading={isLoading}
        columnKeys={columnKeys}
        sortIndex={sortIndex}
        sortDir={sortDir}
        moreCount={Math.min(PAGE_SIZE, Math.max(matches.length - count, 0))}
        onColumnSelect={handleColumnSelect}
        onSortChange={handleSortChange}
        onResetColumns={() => updateParams(Object.fromEntries(BOARD_PARAMS.map((param) => [param, undefined])))}
        onShowMore={() => setShown({ boardKey, count: count + PAGE_SIZE })}
        onShowHidden={() => onMinGamesChange(1)}
      />
    </div>
  );
};

export default CharacterCompare;
