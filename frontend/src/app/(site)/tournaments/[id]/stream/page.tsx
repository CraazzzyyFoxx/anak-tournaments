"use client";

import { useParams } from "next/navigation";
import TournamentStreamPage from "../_views/TournamentStreamPage";

export default function TournamentPublicStreamPage() {
  const params = useParams<{ id: string }>();
  const tournamentId = Number(params.id);

  return <TournamentStreamPage key={tournamentId} tournamentId={tournamentId} />;
}
