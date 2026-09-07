"use client";

import { useTournamentId, useTournamentSlug } from "../_hooks/useTournamentId";
import TournamentOverviewPage from "./TournamentOverviewPage";

/**
 * Client boundary for the root route: `page.tsx` is a server component that
 * validates the slug, this hands off to the overview view with the ids the
 * layout already resolved.
 */
export default function TournamentOverviewRoute() {
  const tournamentId = useTournamentId();
  const slug = useTournamentSlug();
  return <TournamentOverviewPage key={tournamentId} tournamentId={tournamentId} slug={slug} />;
}
