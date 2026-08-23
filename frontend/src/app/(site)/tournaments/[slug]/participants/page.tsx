"use client";

import { useTournamentId, useTournamentSlug } from "../_hooks/useTournamentId";
import TournamentParticipantsPage from "@/app/(site)/tournaments/[slug]/_views/TournamentParticipantsPage";

export default function TournamentParticipantsRoutePage() {
  const tournamentId = useTournamentId();
  const slug = useTournamentSlug();
  return <TournamentParticipantsPage key={tournamentId} slug={slug} />;
}
