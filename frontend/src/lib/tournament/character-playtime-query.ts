import { queryOptions } from "@tanstack/react-query";

import { tournamentQueryKeys } from "@/lib/tournament/query-keys";
import statisticsService from "@/services/statistics.service";
import type { Tournament } from "@/types/tournament.types";

/**
 * Character play-time across the whole tournament, in the tournament's own game and workspace (owner scope) — the
 * statistics section's default sub-tab, and therefore its first-paint read.
 */
export function tournamentCharacterPlaytimeQueryOptions(
  tournament: Pick<Tournament, "id" | "workspace_id" | "discipline">
) {
  return queryOptions({
    queryKey: tournamentQueryKeys.characterPlaytime(tournament.id),
    queryFn: ({ signal }) =>
      statisticsService.getCharacterPlaytime(tournament.discipline, {
        axis: tournament.workspace_id,
        perPage: -1,
        tournamentId: tournament.id,
        signal
      })
  });
}
