import TournamentTabBoundary from "../_prefetch";
import TournamentStreamPage from "../_views/TournamentStreamPage";

type TournamentPublicStreamPageProps = {
  params: Promise<{ slug: string }>;
};

/**
 * Server component for the tournament id and the shared overview; no prefetch
 * of its own. The streams this page renders are the shell's: the layout's
 * overview boundary seeds `tournamentQueryKeys.streams` for the broadcast dock
 * and the nav's Stream tab, and this view reads that same entry.
 */
export default async function TournamentPublicStreamPage({
  params
}: Readonly<TournamentPublicStreamPageProps>) {
  const { slug } = await params;

  return (
    <TournamentTabBoundary slug={slug}>
      {(overview) => <TournamentStreamPage key={overview.id} tournamentId={overview.id} />}
    </TournamentTabBoundary>
  );
}
