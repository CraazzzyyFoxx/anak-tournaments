import React, { Suspense } from "react";
import { redirect } from "next/navigation";

import TournamentTeamsPage, {
  TournamentTeamsPageSkeleton
} from "@/app/tournaments/[id]/pages/TournamentTeamsPage";

import { getTournament } from "./_data";

type TournamentIndexPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    tab?: string;
    page?: string;
    search?: string;
  }>;
};

const isTab = (value: string | undefined) => {
  return value === "teams" || value === "matches" || value === "heroes" || value === "standings";
};

export default async function TournamentIndexPage({
  params,
  searchParams
}: TournamentIndexPageProps) {
  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;

  const tournamentId = Number(resolvedParams.id);
  const tab = resolvedSearchParams.tab;

  if (tab && !isTab(tab)) {
    redirect(`/tournaments/${resolvedParams.id}`);
  }

  if (tab && tab !== "teams") {
    const qs = new URLSearchParams();
    if (tab === "matches") {
      if (resolvedSearchParams.page) qs.set("page", resolvedSearchParams.page);
      if (resolvedSearchParams.search) qs.set("search", resolvedSearchParams.search);
    }
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    redirect(`/tournaments/${resolvedParams.id}/${tab}${suffix}`);
  }

  if (tab === "teams") {
    redirect(`/tournaments/${resolvedParams.id}`);
  }

  const tournament = await getTournament(tournamentId);

  return (
    <Suspense fallback={<TournamentTeamsPageSkeleton />}>
      <TournamentTeamsPage tournament={tournament} />
    </Suspense>
  );
}
