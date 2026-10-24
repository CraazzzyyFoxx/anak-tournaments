"use client";

import { useTranslations } from "next-intl";

import { Skeleton } from "@/components/ui/skeleton";
import { useDisciplineMetadata } from "@/hooks/useDisciplineMetadata";
import type { Tournament } from "@/types/tournament.types";

import { TournamentPageState } from "../../_components/TournamentPageState";
import { compareTeams } from "../tournamentTeams.model";
import { useTournamentTeamsData } from "../useTournamentTeamsData";
import { OverviewSection, SectionLink } from "./OverviewCards";
import { TeamListRow } from "./TeamListRow";

const PREVIEW_COUNT = 6;

/**
 * The teams, once the field is set and before the first match: in the hours
 * before the start they are what a reader came to look at. The strongest by
 * average rating first, as the Teams section's own SR sort orders them, and
 * the very rows it draws — so the same team reads the same in both places,
 * down to the roster it unfolds. Every read is the Teams section's own key.
 */
export function OverviewTeamsSection({
  tournament,
  overviewHref
}: Readonly<{ tournament: Tournament; overviewHref: string }>) {
  const t = useTranslations();
  const { teamsQuery, records, registrationsByUser, heroesMap } = useTournamentTeamsData(tournament);
  const ontology = useDisciplineMetadata(tournament.workspace_id, tournament.discipline).data ?? null;

  const teams = teamsQuery.data?.results ?? [];
  if (teamsQuery.isSuccess && teams.length === 0) return null;
  const strongest = [...teams].sort((a, b) => compareTeams(a, b, "sr")).slice(0, PREVIEW_COUNT);

  return (
    <OverviewSection
      title={t("tournamentDetail.overview.teams.title")}
      action={
        <SectionLink href={`${overviewHref}/teams`}>
          {t("tournamentDetail.overview.teams.all", {
            count: teamsQuery.isSuccess ? teams.length : (tournament.teams_count ?? 0)
          })}
        </SectionLink>
      }
    >
      {teamsQuery.isError ? (
        <TournamentPageState state="initial-error" onRetry={() => void teamsQuery.refetch()} />
      ) : teamsQuery.isPending ? (
        <div className="space-y-2" aria-hidden>
          {Array.from({ length: PREVIEW_COUNT }, (_, index) => (
            <Skeleton key={index} style={{ height: "3.75rem" }} />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {strongest.map((team) => (
            <TeamListRow
              key={team.id}
              team={team}
              tournament={tournament}
              slug={tournament.slug}
              record={records?.get(team.id) ?? null}
              needle=""
              showGroup={false}
              registrationsByUser={registrationsByUser}
              heroesMap={heroesMap}
              ontology={ontology}
            />
          ))}
        </div>
      )}
    </OverviewSection>
  );
}
