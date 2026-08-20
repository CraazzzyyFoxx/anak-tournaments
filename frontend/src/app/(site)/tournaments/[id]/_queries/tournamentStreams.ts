import { queryOptions } from "@tanstack/react-query";

import { tournamentQueryKeys } from "@/lib/tournament-query-keys";
import streamService from "@/services/stream.service";

export function tournamentStreamsQueryOptions(tournamentId: number) {
  return queryOptions({
    queryKey: tournamentQueryKeys.streams(tournamentId),
    queryFn: () => streamService.getTournamentStreams(tournamentId),
    // Half the poller's default 60s interval: the realtime signal carries the
    // change, this is only the floor for tab-focus refetches.
    staleTime: 30_000,
  });
}
