"use client";

import { useQuery } from "@tanstack/react-query";

import type { CharacterCompareProps } from "@/disciplines/types";
import { characterStatsQueryKeys } from "@/lib/characters/query-keys";
import statisticsService from "@/services/statistics.service";

/**
 * The checked character's leaderboard in the host's game and workspace axis (one read shared by both comparison
 * slots); nothing is read before the host has a checked character.
 */
export function useCharacterLeaderboard({ character, tournamentId, axis, metadata }: CharacterCompareProps) {
  const discipline = metadata.discipline.code;
  const query = useQuery({
    queryKey: characterStatsQueryKeys.leaderboard(axis, discipline, character?.id, { stat: null, tournamentId }),
    enabled: character !== undefined,
    // Both comparison slots observe this read and mount independently: fresh for a minute, the later one reuses it.
    staleTime: 60_000,
    queryFn: ({ signal }) =>
      statisticsService.getCharacterLeaderboard(discipline, character!.id, {
        axis,
        tournamentId,
        perPage: -1,
        signal
      })
  });
  return { rows: character ? (query.data?.results ?? []) : [], isLoading: query.isLoading };
}
