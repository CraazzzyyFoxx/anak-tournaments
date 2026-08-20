"use client";

import { useQuery } from "@tanstack/react-query";

import { tournamentOverviewQueryOptions } from "../_queries/tournamentOverview";

export function useTournamentQuery(tournamentId: number) {
  return useQuery({
    ...tournamentOverviewQueryOptions(tournamentId),
    enabled: Number.isFinite(tournamentId) && tournamentId > 0,
  });
}
