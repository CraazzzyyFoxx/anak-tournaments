"use client";

import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { CharacterCompareProps } from "@/disciplines/types";
import { characterClass } from "@/lib/catalog/attrs";

import HeroLeaderboardTable from "./HeroLeaderboardTable";
import { COL, NUM_COLUMNS, getDefaultColumnKeys, type StatKey } from "./stat-columns";
import { useCharacterLeaderboard } from "./useCharacterLeaderboard";

/**
 * Overwatch's character comparison board (the `characterCompare` slot): the fixed per-10 column catalog with the
 * hero class's default columns, five user-picked columns and one shared sort, all kept in the URL (`col0..4`,
 * `sort`, `dir`).
 */
const CharacterCompare = (props: CharacterCompareProps) => {
  const { character, tournamentId, tournamentName } = props;
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { rows, isLoading } = useCharacterLeaderboard(props);

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

  // Memoized so the table's per-column bar scales and its memoized rows stay
  // stable across renders that only change hover state.
  const columnKeys = useMemo<StatKey[]>(
    () =>
      Array.from({ length: NUM_COLUMNS }, (_, i) => {
        const v = searchParams.get(`col${i}`);
        return v && COL[v] ? v : (defaultKeys[i] ?? defaultKeys[0]);
      }),
    [searchParams, defaultKeys]
  );

  // A single active column drives the shared row order of the whole table.
  const rawSortIndex = Number(searchParams.get("sort"));
  const sortIndex = Number.isInteger(rawSortIndex) && rawSortIndex >= 0 && rawSortIndex < NUM_COLUMNS ? rawSortIndex : 0;

  const dirParam = searchParams.get("dir");
  const naturalDir = (key: StatKey) => ((COL[key]?.ascending ?? false) ? "asc" : "desc");
  const sortDir: "asc" | "desc" = dirParam === "asc" || dirParam === "desc" ? dirParam : naturalDir(columnKeys[sortIndex]);

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
    <HeroLeaderboardTable
      selectedHero={character}
      selectedTournamentName={tournamentName}
      tournamentId={tournamentId}
      rows={rows}
      isLoading={isLoading}
      columnKeys={columnKeys}
      sortIndex={sortIndex}
      sortDir={sortDir}
      onColumnSelect={handleColumnSelect}
      onSortChange={handleSortChange}
    />
  );
};

export default CharacterCompare;
