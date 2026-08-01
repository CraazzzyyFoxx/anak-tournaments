"use client";

import { useParams } from "next/navigation";

import TournamentHeroPlaytimePage from "@/app/(site)/tournaments/[id]/_views/TournamentHeroPlaytimePage";

export default function TournamentHeroesPage() {
  const params = useParams<{ id: string }>();
  return <TournamentHeroPlaytimePage key={params.id} tournamentId={Number(params.id)} />;
}
