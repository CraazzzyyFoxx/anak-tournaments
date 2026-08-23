"use client";

import { useTournamentId, useTournamentSlug } from "../_hooks/useTournamentId";
import TournamentHeroPlaytimePage from "@/app/(site)/tournaments/[slug]/_views/TournamentHeroPlaytimePage";

export default function TournamentHeroesPage() {
  const tournamentId = useTournamentId();
  const slug = useTournamentSlug();
  return <TournamentHeroPlaytimePage key={tournamentId} tournamentId={tournamentId} slug={slug} />;
}
