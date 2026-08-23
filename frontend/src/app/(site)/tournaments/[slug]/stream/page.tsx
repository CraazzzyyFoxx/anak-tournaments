"use client";

import { useTournamentId } from "../_hooks/useTournamentId";
import TournamentStreamPage from "../_views/TournamentStreamPage";

export default function TournamentPublicStreamPage() {
  const tournamentId = useTournamentId();

  return <TournamentStreamPage key={tournamentId} tournamentId={tournamentId} />;
}
