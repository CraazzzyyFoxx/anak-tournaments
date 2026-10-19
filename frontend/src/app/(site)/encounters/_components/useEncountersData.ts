"use client";

import { useMemo } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import encounterService from "@/services/encounter.service";
import tournamentService from "@/services/tournament.service";
import { encounterQueryKeys } from "@/lib/encounters/query-keys";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type { LookupItem, PaginatedResponse } from "@/types/pagination.types";
import type { StatsScope } from "@/lib/site/stats-scope";
import type { Encounter, EncounterOverview } from "@/types/encounter.types";

import { ENCOUNTERS_PAGE_SIZE, filtersToApiFilters, type EncounterFilterState } from "./encounters.helpers";

/** The server render's reads and the one game they were made for. */
export interface EncountersSeed {
  discipline: string;
  data: PaginatedResponse<Encounter>;
  overview: EncounterOverview;
}

export interface EncountersDataInput {
  seed: EncountersSeed | null;
  initialFilters: EncounterFilterState;
  initialPage: number;
  effectiveFilters: EncounterFilterState;
  page: number;
  scope: StatsScope;
  /** The resolved browsing game; `null` (resolving, invalid, empty) reads nothing. */
  discipline: string | null;
}

export interface EncountersData {
  listQuery: UseQueryResult<PaginatedResponse<Encounter>>;
  overviewQuery: UseQueryResult<EncounterOverview>;
  tournamentsLookupQuery: UseQueryResult<LookupItem[]>;
}

/**
 * The three reads the encounters index renders from, all of one game. The list and
 * the overview seed off the server-rendered payload only while the game and the
 * filters still match the ones that payload was built for — otherwise the first
 * client-side change would paint another answer as if it were this one. For the same
 * reason the previous page stays on screen while another page or filter of the same
 * game loads, but never another game's rows.
 */
export function useEncountersData({
  seed,
  initialFilters,
  initialPage,
  effectiveFilters,
  page,
  scope,
  discipline
}: EncountersDataInput): EncountersData {
  const currentWorkspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);
  // One value carries the workspace dimension of every read and its cache key.
  const workspaceId = scope === "all" ? "all" : currentWorkspaceId;
  const apiFilters = useMemo(() => filtersToApiFilters(effectiveFilters), [effectiveFilters]);
  const matchingSeed =
    seed?.discipline === discipline && JSON.stringify(effectiveFilters) === JSON.stringify(initialFilters)
      ? seed
      : null;

  const listQuery = useQuery({
    queryKey: encounterQueryKeys.list(workspaceId, discipline, page, apiFilters, effectiveFilters.query),
    queryFn: ({ signal }) =>
      encounterService.getAll(
        page,
        effectiveFilters.query,
        null,
        ENCOUNTERS_PAGE_SIZE,
        apiFilters.sort ?? "id",
        "desc",
        workspaceId,
        {
          ...apiFilters,
          discipline,
          entities: [
            "tournament",
            "stage",
            "stage_item",
            "teams",
            "matches",
            "matches.map"
          ]
        },
        { signal }
      ),
    enabled: discipline !== null,
    initialData: page === initialPage ? matchingSeed?.data : undefined,
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[2] === discipline ? previous : undefined)
  });

  const overviewQuery = useQuery({
    queryKey: encounterQueryKeys.overview(workspaceId, discipline, apiFilters, effectiveFilters.query),
    queryFn: ({ signal }) =>
      encounterService.getOverview(effectiveFilters.query, { ...apiFilters, discipline }, workspaceId, { signal }),
    enabled: discipline !== null,
    initialData: matchingSeed?.overview,
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[2] === discipline ? previous : undefined),
    retry: 1
  });

  const tournamentsLookupQuery = useQuery({
    queryKey: encounterQueryKeys.tournamentsLookup(workspaceId, discipline),
    queryFn: ({ signal }) => tournamentService.lookup(workspaceId, discipline, { signal }),
    enabled: discipline !== null,
    staleTime: 5 * 60_000,
    retry: 1
  });

  return { listQuery, overviewQuery, tournamentsLookupQuery };
}
