"use client";

import { useTournamentId, useTournamentSlug } from "../_hooks/useTournamentId";
import TournamentStandingsPage from "@/app/(site)/tournaments/[slug]/_views/TournamentStandingsPage";

export default function TournamentStandingsRoutePage() {
  const tournamentId = useTournamentId();
  const slug = useTournamentSlug();
  return <TournamentStandingsPage key={tournamentId} slug={slug} />;
}
