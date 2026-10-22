"use client";

import { useQuery } from "@tanstack/react-query";

import type { CharacterCompareProps } from "@/disciplines/types";
import { characterStatsQueryKeys } from "@/lib/characters/query-keys";
import statisticsService from "@/services/statistics.service";
import type { DivisionGridVersion } from "@/types/workspace.types";

/**
 * The checked character's leaderboard in the host's game and workspace axis, with every division grid its rows' `div`
 * is a number on; nothing is read before the host has a checked character.
 */
export function useCharacterLeaderboard({ character, tournamentId, axis, metadata }: CharacterCompareProps) {
  const discipline = metadata.discipline.code;
  const query = useQuery({
    queryKey: characterStatsQueryKeys.leaderboard(axis, discipline, character?.id, { stat: null, tournamentId }),
    enabled: character !== undefined,
    // Fresh for a minute: flipping between heroes or scopes reuses a board already read.
    staleTime: 60_000,
    queryFn: ({ signal }) =>
      statisticsService.getCharacterLeaderboard(discipline, character!.id, {
        axis,
        tournamentId,
        perPage: -1,
        signal
      }),
    // The grids as the division readers take them (a grid read without tiers has none). Structural sharing keeps
    // the references stable across renders, so the board's memoized rows hold.
    select: (page) => ({
      rows: page.results,
      grids: (page.division_grids ?? []).map((grid): DivisionGridVersion => ({ ...grid, tiers: grid.tiers ?? [] }))
    })
  });
  return {
    rows: character ? (query.data?.rows ?? []) : [],
    grids: character ? (query.data?.grids ?? []) : [],
    isLoading: query.isLoading
  };
}
