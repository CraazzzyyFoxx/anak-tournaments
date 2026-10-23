import TournamentTabBoundary from "../_prefetch";
import TournamentStatsPage from "../_views/TournamentStatsPage";
import { tournamentCharacterPlaytimeQueryOptions } from "@/lib/tournament/character-playtime-query";

type TournamentStatsRoutePageProps = {
  params: Promise<{ slug: string }>;
};

/**
 * Only the `heroes` (characters) sub-tab is prefetched — it is the default, and the `maps`
 * table costs the whole encounter list with its matches. The reader who asks
 * for maps waits for one request instead of every reader waiting for it.
 */
export default async function TournamentStatsRoutePage({
  params
}: Readonly<TournamentStatsRoutePageProps>) {
  const { slug } = await params;

  return (
    <TournamentTabBoundary
      slug={slug}
      prefetch={(queryClient, overview) =>
        queryClient.prefetchQuery(tournamentCharacterPlaytimeQueryOptions(overview))
      }
    >
      {(overview) => (
        <TournamentStatsPage key={overview.id} slug={slug} />
      )}
    </TournamentTabBoundary>
  );
}
