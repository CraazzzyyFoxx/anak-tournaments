"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { Tournament } from "@/types/tournament.types";
import { Team } from "@/types/team.types";
import teamService from "@/services/team.service";
import { TournamentTeamCard } from "@/components/TournamentTeamCard";
import { FilterChip } from "@/components/ui/filter-chip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { tournamentQueryKeys } from "@/lib/tournament-query-keys";

import { TournamentPageState } from "../_components/TournamentPageState";
import { TournamentTeamsSkeleton } from "../_components/TournamentSkeletons";
import { UpdatingBadge } from "../_components/UpdatingBadge";
import { useTournamentQuery } from "../_hooks/useTournamentClientData";
import { getPublicPageQueryPresentation } from "./publicPageQueryPresentation";

type SortBy = "placement" | "sr" | "name";

function sortTeams(teams: Team[], sortBy: SortBy): Team[] {
  return [...teams].sort((a, b) => {
    switch (sortBy) {
      case "placement": {
        const ap = a.placement ?? Number.POSITIVE_INFINITY;
        const bp = b.placement ?? Number.POSITIVE_INFINITY;
        return ap - bp;
      }
      case "sr":
        return (b.avg_sr ?? 0) - (a.avg_sr ?? 0);
      case "name":
        return a.name.localeCompare(b.name);
      default:
        return 0;
    }
  });
}

const TournamentTeamsView = ({ tournament }: { tournament: Tournament }) => {
  const t = useTranslations();
  const teamsQuery = useQuery({
    queryKey: tournamentQueryKeys.teams(tournament.id, tournament.workspace_id),
    queryFn: () =>
      teamService.getAll({
        tournamentId: tournament.id,
        workspaceId: tournament.workspace_id
      })
  });

  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortBy>("placement");

  const teams = useMemo(() => teamsQuery.data?.results ?? [], [teamsQuery.data]);

  const groups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const team of teams) {
      const name = team.group?.name;
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [teams]);

  const visibleTeams = useMemo(() => {
    const filtered =
      groupFilter === "all" ? teams : teams.filter((team) => team.group?.name === groupFilter);
    return sortTeams(filtered, sortBy);
  }, [teams, groupFilter, sortBy]);

  const presentation = getPublicPageQueryPresentation({
    data: teamsQuery.data,
    itemCount: teams.length,
    isPending: teamsQuery.isPending,
    isError: teamsQuery.isError,
    isFetching: teamsQuery.isFetching
  });

  if (presentation.initialState === "error") {
    return <TournamentPageState state="initial-error" onRetry={() => void teamsQuery.refetch()} />;
  }

  if (presentation.initialState === "skeleton" || presentation.contentState === null) {
    return <TournamentTeamsSkeleton />;
  }

  const content = (
    <div className="space-y-4">
      {presentation.showUpdating ? <UpdatingBadge /> : null}
      {presentation.contentState === "empty" ? (
        <TournamentPageState state="empty" />
      ) : (
        <>
          <div className="filters" role="group" aria-label={t("common.filters")}>
            <FilterChip
              active={groupFilter === "all"}
              count={teams.length}
              onClick={() => setGroupFilter("all")}
            >
              {t("common.all")}
            </FilterChip>
            {groups.map(([name, count]) => (
              <FilterChip
                key={name}
                active={groupFilter === name}
                count={count}
                onClick={() => setGroupFilter(name)}
              >
                {t("common.group")} {name}
              </FilterChip>
            ))}

            <Select value={sortBy} onValueChange={(value) => setSortBy(value as SortBy)}>
              <SelectTrigger
                aria-label={t("tournamentDetail.sortTeams")}
                className="filter-sort ml-auto h-8 w-[170px] shadow-none focus:ring-0 focus:ring-offset-0"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="placement">{t("common.byPlacement")}</SelectItem>
                <SelectItem value="sr">{t("common.byAvgSr")}</SelectItem>
                <SelectItem value="name">{t("common.byName")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {visibleTeams.length === 0 ? (
            <TournamentPageState state="filtered-empty" onReset={() => setGroupFilter("all")} />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {visibleTeams.map((team) => (
                <TournamentTeamCard key={team.id} team={team} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );

  if (presentation.showRefreshError) {
    return (
      <TournamentPageState
        state="refresh-error"
        onRetry={() => void teamsQuery.refetch()}
        isUpdating={teamsQuery.isFetching}
      >
        {content}
      </TournamentPageState>
    );
  }

  return content;
};

/**
 * Resolves the shared tournament overview so the route file stays a one-line
 * delegation, matching every other tournament sub-route. The overview is
 * already primed by the layout, so this is a cache read in practice — the
 * guards below only fire if that layout contract ever changes.
 */
const TournamentTeamsPage = ({ slug }: { slug: string }) => {
  // Keyed by `slug`: shares TournamentClientLayout's overview cache entry.
  const tournamentQuery = useTournamentQuery(slug);

  if (!tournamentQuery.data) {
    if (tournamentQuery.isError) {
      return (
        <TournamentPageState state="initial-error" onRetry={() => void tournamentQuery.refetch()} />
      );
    }
    return <TournamentTeamsSkeleton />;
  }

  return <TournamentTeamsView tournament={tournamentQuery.data} />;
};

export default TournamentTeamsPage;
