import { notFound, redirect } from "next/navigation";

import { getTournamentOverviewState } from "./_data";
import TournamentOverviewRoute from "./_views/TournamentOverviewRoute";

type TournamentIndexPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    tab?: string;
    page?: string;
    search?: string;
  }>;
};

/**
 * Pre-redesign deep links used `?tab=` on the root. Each maps onto the section
 * that now owns that content; anything else falls through to the overview.
 */
const LEGACY_TAB_PATH: Record<string, string> = {
  teams: "/teams",
  participants: "/participants",
  matches: "/matches",
  heroes: "/stats?tab=heroes",
  standings: "/bracket?view=standings"
};

export default async function TournamentIndexPage({
  params,
  searchParams
}: TournamentIndexPageProps) {
  const { slug } = await params;
  const { tab, page, search } = await searchParams;

  if (tab) {
    const target = LEGACY_TAB_PATH[tab];
    if (!target) redirect(`/tournaments/${slug}`);
    const qs = new URLSearchParams();
    if (tab === "matches") {
      if (page) qs.set("page", page);
      if (search) qs.set("search", search);
    }
    const joiner = target.includes("?") ? "&" : "?";
    const suffix = qs.toString() ? `${joiner}${qs.toString()}` : "";
    redirect(`/tournaments/${slug}${target}${suffix}`);
  }

  const overviewState = await getTournamentOverviewState(slug);
  if (overviewState.kind === "not-found") {
    notFound();
  }
  if (overviewState.kind === "error") {
    return null;
  }

  return <TournamentOverviewRoute />;
}
