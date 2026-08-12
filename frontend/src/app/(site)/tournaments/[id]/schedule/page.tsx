"use client";

import { useParams } from "next/navigation";
import TournamentSchedulePage from "../_views/TournamentSchedulePage";

export default function TournamentPublicSchedulePage() {
  const params = useParams<{ id: string }>();
  const tournamentId = Number(params.id);

  return <TournamentSchedulePage key={tournamentId} tournamentId={tournamentId} />;
}
