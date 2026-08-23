"use client";

import { useTournamentId, useTournamentSlug } from "../_hooks/useTournamentId";
import TournamentBracketPage from "./TournamentBracketPage";

export default function BracketPage() {
  const tournamentId = useTournamentId();
  const slug = useTournamentSlug();
  return <TournamentBracketPage key={tournamentId} slug={slug} />;
}
