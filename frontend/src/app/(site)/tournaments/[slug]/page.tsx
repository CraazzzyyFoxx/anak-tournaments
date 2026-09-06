import { notFound } from "next/navigation";

import { getTournamentOverviewState } from "./_data";
import TournamentOverviewRoute from "./_views/TournamentOverviewRoute";

type TournamentIndexPageProps = {
  params: Promise<{ slug: string }>;
};

export default async function TournamentIndexPage({ params }: TournamentIndexPageProps) {
  const { slug } = await params;

  const overviewState = await getTournamentOverviewState(slug);
  if (overviewState.kind === "not-found") {
    notFound();
  }
  if (overviewState.kind === "error") {
    return null;
  }

  return <TournamentOverviewRoute />;
}
