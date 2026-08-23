"use client";

import { useTournamentId, useTournamentSlug } from "../_hooks/useTournamentId";
import TournamentMapsPage from "../_views/TournamentMapsPage";

export default function TournamentPublicMapsPage() {
  const tournamentId = useTournamentId();
  const slug = useTournamentSlug();

  return <TournamentMapsPage key={tournamentId} tournamentId={tournamentId} slug={slug} />;
}
