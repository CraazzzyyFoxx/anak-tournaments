import { notFound, redirect } from "next/navigation";

import type { TournamentStatus } from "@/types/tournament.types";

import { getTournamentOverviewState } from "./_data";

type TournamentIndexPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    tab?: string;
    page?: string;
    search?: string;
  }>;
};

const isTab = (value: string | undefined) => {
  return (
    value === "teams" ||
    value === "participants" ||
    value === "matches" ||
    value === "heroes" ||
    value === "standings"
  );
};

const REGISTRATION_PHASES = new Set<TournamentStatus>(["draft", "registration", "check_in"]);
const BRACKET_PHASES = new Set<TournamentStatus>(["live", "playoffs", "completed", "archived"]);

function getDefaultTournamentPath({
  slug,
  status,
  hasStages
}: {
  slug: string;
  status: TournamentStatus;
  hasStages: boolean;
}) {
  if (BRACKET_PHASES.has(status) && hasStages) {
    return `/tournaments/${slug}/bracket`;
  }

  if (REGISTRATION_PHASES.has(status)) {
    return `/tournaments/${slug}/participants`;
  }

  return null;
}

export default async function TournamentIndexPage({
  params,
  searchParams
}: TournamentIndexPageProps) {
  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  const slug = resolvedParams.slug;
  const teamsPath = `/tournaments/${slug}/teams`;

  const tab = resolvedSearchParams.tab;

  if (tab && !isTab(tab)) {
    redirect(`/tournaments/${slug}`);
  }

  if (tab && tab !== "teams") {
    const qs = new URLSearchParams();
    if (tab === "matches") {
      if (resolvedSearchParams.page) qs.set("page", resolvedSearchParams.page);
      if (resolvedSearchParams.search) qs.set("search", resolvedSearchParams.search);
    }
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    redirect(`/tournaments/${slug}/${tab}${suffix}`);
  }

  if (tab === "teams") {
    redirect(teamsPath);
  }

  const overviewState = await getTournamentOverviewState(slug);
  if (overviewState.kind === "not-found") {
    notFound();
  }
  if (overviewState.kind === "error") {
    return null;
  }

  const defaultPath = getDefaultTournamentPath({
    slug,
    status: overviewState.overview.status,
    hasStages: overviewState.overview.stages.length > 0
  });

  if (defaultPath) {
    redirect(defaultPath);
  }

  redirect(teamsPath);
}
