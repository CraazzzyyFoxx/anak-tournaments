"use client";

import { useSearchParams } from "next/navigation";

import { useTournamentId, useTournamentSlug } from "../_hooks/useTournamentId";
import TournamentEncountersPage from "@/app/(site)/tournaments/[slug]/_views/TournamentEncountersPage";

export default function TournamentMatchesPage() {
  const tournamentId = useTournamentId();
  const slug = useTournamentSlug();
  const searchParams = useSearchParams();
  const page = Number.parseInt(searchParams.get("page") ?? "1", 10) || 1;
  const search = searchParams.get("search") ?? "";

  return (
    <TournamentEncountersPage
      key={tournamentId}
      tournamentId={tournamentId}
      slug={slug}
      page={page}
      search={search}
    />
  );
}
