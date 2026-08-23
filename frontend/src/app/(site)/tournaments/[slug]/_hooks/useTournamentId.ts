"use client";

import { createContext, useContext } from "react";

/**
 * Supplied by `TournamentClientLayout` once its overview query resolves. The
 * URL segment is the public slug (or a legacy numeric id / retired slug) --
 * nested tab pages read both pieces from here instead of `useParams()`, which
 * after the slug migration no longer carries a number at all:
 *
 * - `tournamentId`: the resolved numeric id, for a tab's OWN API calls
 *   (`?tournament_id=`) and query keys (stages/standings/teams/encounters),
 *   which stay numeric to match realtime invalidation.
 * - `slug`: the exact ref `TournamentClientLayout` fetched the overview by.
 *   A tab that re-reads the overview (`useTournamentQuery`) must key by this,
 *   not `tournamentId`, to land on the SAME cache entry instead of triggering
 *   a redundant fetch under a different key.
 */
type TournamentRouteContextValue = {
  tournamentId: number;
  slug: string;
};

const TournamentRouteContext = createContext<TournamentRouteContextValue | null>(null);

export const TournamentRouteProvider = TournamentRouteContext.Provider;

function useTournamentRouteContext(): TournamentRouteContextValue {
  const value = useContext(TournamentRouteContext);
  if (value === null) {
    throw new Error("useTournamentId()/useTournamentSlug() must be used within the tournament route tree");
  }
  return value;
}

export function useTournamentId(): number {
  return useTournamentRouteContext().tournamentId;
}

export function useTournamentSlug(): string {
  return useTournamentRouteContext().slug;
}
