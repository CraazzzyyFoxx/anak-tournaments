"use client";

import { useTournamentId, useTournamentSlug } from "../_hooks/useTournamentId";
import TournamentTeamsPage from "@/app/(site)/tournaments/[slug]/_views/TournamentTeamsPage";

export default function TournamentTeamsRoutePage() {
  const tournamentId = useTournamentId();
  const slug = useTournamentSlug();
  return <TournamentTeamsPage key={tournamentId} slug={slug} />;
}
