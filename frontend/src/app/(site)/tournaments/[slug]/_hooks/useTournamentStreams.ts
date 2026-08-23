"use client";

import { useQuery } from "@tanstack/react-query";

import { tournamentStreamsQueryOptions } from "../_queries/tournamentStreams";

export function useTournamentStreamsQuery(tournamentId: number | undefined) {
  return useQuery({
    ...tournamentStreamsQueryOptions(tournamentId ?? -1),
    enabled: typeof tournamentId === "number" && Number.isFinite(tournamentId) && tournamentId > 0,
  });
}
