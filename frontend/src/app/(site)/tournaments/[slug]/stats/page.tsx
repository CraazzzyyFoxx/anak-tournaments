"use client";

import { useTournamentId, useTournamentSlug } from "../_hooks/useTournamentId";
import TournamentStatsPage from "../_views/TournamentStatsPage";

export default function TournamentStatsRoutePage() {
  const tournamentId = useTournamentId();
  const slug = useTournamentSlug();
  return <TournamentStatsPage key={tournamentId} tournamentId={tournamentId} slug={slug} />;
}
