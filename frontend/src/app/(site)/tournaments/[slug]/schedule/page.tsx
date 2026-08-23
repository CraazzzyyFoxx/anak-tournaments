"use client";

import { useTournamentId, useTournamentSlug } from "../_hooks/useTournamentId";
import TournamentSchedulePage from "../_views/TournamentSchedulePage";

export default function TournamentPublicSchedulePage() {
  const tournamentId = useTournamentId();
  const slug = useTournamentSlug();

  return <TournamentSchedulePage key={tournamentId} slug={slug} />;
}
