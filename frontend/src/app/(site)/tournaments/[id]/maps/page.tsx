"use client";

import { useParams } from "next/navigation";
import TournamentMapsPage from "../_views/TournamentMapsPage";

export default function TournamentPublicMapsPage() {
  const params = useParams<{ id: string }>();
  const tournamentId = Number(params.id);

  return <TournamentMapsPage key={tournamentId} tournamentId={tournamentId} />;
}
