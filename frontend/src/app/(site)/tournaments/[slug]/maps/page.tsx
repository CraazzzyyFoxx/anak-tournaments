"use client";

import TournamentMapsPage from "../_views/TournamentMapsPage";
import { useTournamentId, useTournamentSlug } from "../_hooks/useTournamentId";

export default function TournamentMapsRoutePage() {
  const tournamentId = useTournamentId();
  const slug = useTournamentSlug();
  return <TournamentMapsPage key={tournamentId} tournamentId={tournamentId} slug={slug} />;
}
