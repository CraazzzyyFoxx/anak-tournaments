"use client";

import { useMemo } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import encounterService from "@/services/encounter.service";
import tournamentService from "@/services/tournament.service";
import { encounterQueryKeys } from "@/lib/encounters/query-keys";
import { ALL_DISCIPLINES } from "@/lib/site/discipline-scope";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type { LookupItem, PaginatedResponse } from "@/types/pagination.types";
import type { StatsScope } from "@/lib/site/stats-scope";
import type { Encounter, EncounterInsights, EncounterOverview } from "@/types/encounter.types";

import {
  aggregateFilters,
  ENCOUNTERS_PAGE_SIZE,
  listReadArgs,
  sameFilters,
  type EncounterFilterState,
  type EncountersUrlState,
  type EncountersView
} from "./encounters.helpers";

/** The server render's reads and the game they were made for (`null` = every game). */
export interface EncountersSeed {
  discipline: string | null;
  /** `null` when the page opened on the summary, which reads no list. */
  data: PaginatedResponse<Encounter> | null;
  /** The global overview: no filters, the game and workspace only. */
  overview: EncounterOverview;
  /** The overview under the URL's filters: the same object when nothing narrows. */
  counts: EncounterOverview;
}

export interface EncountersDataInput {
  seed: EncountersSeed | null;
  initial: EncountersUrlState;
  effectiveFilters: EncounterFilterState;
  page: number;
  view: EncountersView;
  scope: StatsScope;
  /** The page's game; `null` is every game. */
  discipline: string | null;
  /** The game resolved to every game or one game: nothing is read while resolving, nor for an invalid/empty one. */
  enabled: boolean;
}

export interface EncountersData {
  listQuery: UseQueryResult<PaginatedResponse<Encounter>>;
  /** The hero's global numbers. */
  overviewQuery: UseQueryResult<EncounterOverview>;
  /** The toolbar's counts under the current filters. */
  countsQuery: UseQueryResult<EncounterOverview>;
  insightsQuery: UseQueryResult<EncounterInsights>;
  tournamentsLookupQuery: UseQueryResult<LookupItem[]>;
}

/**
 * The reads the encounters index renders from, all of one game or of every game. The list and both overviews seed
 * off the server-rendered payload only while the game and the filters still match the ones that payload was built
 * for — otherwise the first client-side change would paint another answer as if it were this one. For the same
 * reason the previous page stays on screen while another page or filter of the same game loads, but never another
 * game's rows. The list is read in the list view and the insights (the heavy read) in theirs only. The tournament
 * picker is one game's (spec §6.2): under every game it is not offered, so not read.
 */
export function useEncountersData({
  seed,
  initial,
  effectiveFilters,
  page,
  view,
  scope,
  discipline,
  enabled
}: EncountersDataInput): EncountersData {
  const currentWorkspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);
  // One value carries the workspace dimension of every read and its cache key.
  const workspaceId = scope === "all" ? "all" : currentWorkspaceId;
  const disciplineKey = discipline ?? ALL_DISCIPLINES;
  const read = useMemo(() => listReadArgs(effectiveFilters, page), [effectiveFilters, page]);
  const counted = useMemo(() => aggregateFilters(effectiveFilters), [effectiveFilters]);
  // The server forces insights to completed encounters: the status segment never splits their cache.
  const summarized = useMemo(() => aggregateFilters({ ...effectiveFilters, status: null }), [effectiveFilters]);
  const gameSeed = seed !== null && seed.discipline === discipline ? seed : null;
  const filterSeed = gameSeed && sameFilters(effectiveFilters, initial.filters) ? gameSeed : null;
  const sameGame = <T,>(previous: T | undefined, previousQuery?: { queryKey: readonly unknown[] }) =>
    previousQuery?.queryKey[2] === disciplineKey ? previous : undefined;

  const listQuery = useQuery({
    queryKey: encounterQueryKeys.list(workspaceId, disciplineKey, page, read, read.query),
    queryFn: ({ signal }) =>
      encounterService.getAll(
        page,
        read.query,
        null,
        ENCOUNTERS_PAGE_SIZE,
        read.sort,
        read.order,
        workspaceId,
        { ...read.filters, discipline },
        { signal }
      ),
    enabled: enabled && view === "list",
    initialData: page === initial.page ? (filterSeed?.data ?? undefined) : undefined,
    placeholderData: sameGame
  });

  const overviewQuery = useQuery({
    queryKey: encounterQueryKeys.overview(workspaceId, disciplineKey, {}, ""),
    queryFn: ({ signal }) => encounterService.getOverview("", { discipline }, workspaceId, { signal }),
    enabled,
    initialData: gameSeed?.overview,
    retry: 1
  });

  const countsQuery = useQuery({
    queryKey: encounterQueryKeys.overview(workspaceId, disciplineKey, counted, effectiveFilters.query),
    queryFn: ({ signal }) =>
      encounterService.getOverview(effectiveFilters.query, { ...counted, discipline }, workspaceId, { signal }),
    enabled,
    initialData: filterSeed?.counts,
    placeholderData: sameGame,
    retry: 1
  });

  const insightsQuery = useQuery({
    queryKey: encounterQueryKeys.insights(workspaceId, disciplineKey, summarized, effectiveFilters.query),
    queryFn: ({ signal }) =>
      encounterService.getInsights(effectiveFilters.query, { ...summarized, discipline }, workspaceId, { signal }),
    enabled: enabled && view === "insights",
    placeholderData: sameGame,
    retry: 1
  });

  const tournamentsLookupQuery = useQuery({
    queryKey: encounterQueryKeys.tournamentsLookup(workspaceId, disciplineKey),
    queryFn: ({ signal }) => tournamentService.lookup(workspaceId, discipline, { signal }),
    enabled: enabled && discipline !== null,
    staleTime: 5 * 60_000,
    retry: 1
  });

  return { listQuery, overviewQuery, countsQuery, insightsQuery, tournamentsLookupQuery };
}
