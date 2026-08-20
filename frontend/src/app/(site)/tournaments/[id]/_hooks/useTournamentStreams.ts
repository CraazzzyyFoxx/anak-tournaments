"use client";

import { useQuery } from "@tanstack/react-query";

import { tournamentStreamsQueryOptions } from "../_queries/tournamentStreams";

export function useTournamentStreamsQuery(tournamentId: number) {
  return useQuery({
    ...tournamentStreamsQueryOptions(tournamentId),
    enabled: Number.isFinite(tournamentId) && tournamentId > 0,
  });
}
