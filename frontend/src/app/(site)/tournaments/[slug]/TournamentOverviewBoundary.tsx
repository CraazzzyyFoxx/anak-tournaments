import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { getTournamentOverviewState } from "./_data";
import { tournamentOverviewQueryOptions } from "@/lib/tournament/overview-query";

type TournamentOverviewBoundaryProps = {
  slug: string;
  children: ReactNode;
};

// Seeds the request's React Query cache with the SSR-fetched overview and
// renders the client shell INSIDE that seed, so `useTournamentQuery` resolves
// from it in both renderers. The shell must be a child, not a sibling: the
// server renders a suspended component's siblings before it resolves, so a
// sibling shell built the overview query empty (pending) first, and
// HydrationBoundary only fills an existing query in an effect — which never
// runs on the server. Every cache-missing first visit then streamed the
// skeleton while the browser rendered the page: a hydration mismatch that
// threw the shell away.
export default async function TournamentOverviewBoundary({
  slug,
  children
}: Readonly<TournamentOverviewBoundaryProps>) {
  const overviewState = await getTournamentOverviewState(slug);

  if (overviewState.kind === "not-found") {
    // Intentional streamed soft-404: shell-first TTFB wins for valid refs
    // whose remote lookup misses.
    notFound();
  }

  if (overviewState.kind === "error") {
    // No seed: the shell's own `useTournamentQuery` fails client-side and
    // renders the shared error card itself.
    return children;
  }

  const queryClient = new QueryClient();
  const overviewOptions = tournamentOverviewQueryOptions(slug);
  queryClient.setQueryData(overviewOptions.queryKey, overviewState.overview);

  return <HydrationBoundary state={dehydrate(queryClient)}>{children}</HydrationBoundary>;
}
