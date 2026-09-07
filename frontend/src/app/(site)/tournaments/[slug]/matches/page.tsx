"use client";

import { useTournamentId, useTournamentSlug } from "../_hooks/useTournamentId";
import TournamentEncountersPage from "@/app/(site)/tournaments/[slug]/_views/TournamentEncountersPage";

export default function TournamentMatchesPage() {
  const tournamentId = useTournamentId();
  const slug = useTournamentSlug();
  return <TournamentEncountersPage key={tournamentId} tournamentId={tournamentId} slug={slug} />;
}
