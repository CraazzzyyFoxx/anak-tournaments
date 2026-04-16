import React, { Suspense } from "react";

import TournamentTeamsPage, {
  TournamentTeamsPageSkeleton,
} from "@/app/(site)/tournaments/[id]/pages/TournamentTeamsPage";

import { getTournament } from "../_data";

type TournamentTeamsRoutePageProps = {
  params: Promise<{ id: string }>;
};

export default async function TournamentTeamsRoutePage({
  params,
}: TournamentTeamsRoutePageProps) {
  const resolvedParams = await params;
  const tournament = await getTournament(Number(resolvedParams.id));

  return (
    <Suspense fallback={<TournamentTeamsPageSkeleton />}>
      <TournamentTeamsPage tournament={tournament} />
    </Suspense>
  );
}
