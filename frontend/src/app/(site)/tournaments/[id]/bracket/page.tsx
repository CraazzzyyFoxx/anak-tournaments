"use client";

import { useParams } from "next/navigation";

import TournamentBracketPage from "./TournamentBracketPage";

export default function BracketPage() {
  const params = useParams<{ id: string }>();
  return <TournamentBracketPage key={params.id} tournamentId={Number(params.id)} />;
}
