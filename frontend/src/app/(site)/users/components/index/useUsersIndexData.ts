"use client";

import { useMemo } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import userService from "@/services/user.service";
import { userQueryKeys } from "@/lib/users/query-keys";
import { useCurrentWorkspaceId } from "@/hooks/useCurrentWorkspace";
import type { RoleOntology } from "@/lib/roster/ontology";
import type { DisciplineMetadata } from "@/types/discipline.types";
import type { UserCatalogResponse, UserOverviewResponse, UserOverviewStats } from "@/types/user.types";

import { roleFilterOf } from "./users-index.model";
import type { UsersIndexParams } from "./useUsersIndexParams";

export interface UsersIndexData {
  overviewQuery: UseQueryResult<UserOverviewResponse>;
  statsQuery: UseQueryResult<UserOverviewStats>;
  catalogQuery: UseQueryResult<UserCatalogResponse>;
  maxPage: number;
  /** 1-based index of the first and last row on screen, or null when empty. */
  range: { start: number; end: number } | null;
  availableLetters: Set<string>;
  /** `workspace_id` every read on this page is pinned to. */
  workspaceId: number | "all" | null;
  /** The game every read is in; `null` while unresolved or invalid. */
  discipline: string | null;
  /** That game's role dictionary (names and glyphs); `null` while it loads. */
  ontology: RoleOntology | null;
}

/**
 * The three reads behind the index, all in the browsed game (`discipline`, `null` while unresolved or invalid —
 * nothing is read then). Only the view on screen pays for its own list — the stats strip is shared by both, so
 * it always runs. A previous result is kept on screen while a filter changes, never across games.
 */
export function useUsersIndexData(
  params: UsersIndexParams,
  discipline: string | null,
  metadata: DisciplineMetadata | null
): UsersIndexData {
  const currentWorkspaceId = useCurrentWorkspaceId();
  const { page, perPage, query, sort, order, role, divisions, hasLogs, minEncounters, letter, view, scope } =
    params;
  // One value carries the workspace dimension of every read and every key:
  // a workspace id, or the backend's cross-workspace sentinel.
  const workspaceId = scope === "all" ? "all" : currentWorkspaceId;
  // Query keys take scalars only, and the array identity changes every render.
  const divisionsKey = divisions.join(",");
  const game = discipline ?? "";
  // Every index key carries the game at position 2.
  const sameGame = <T,>(previous: T | undefined, previousQuery: { queryKey: readonly unknown[] } | undefined) =>
    previousQuery?.queryKey[2] === discipline ? previous : undefined;
  // A role chip needs the game's rated dimension: such a read waits for the metadata rather than running unfiltered.
  const roleFilter = roleFilterOf(metadata, role);
  const ready = discipline !== null && (role === undefined || roleFilter !== undefined);

  const overviewQuery = useQuery({
    queryKey: userQueryKeys.overview(
      workspaceId,
      game,
      page,
      perPage,
      query,
      sort,
      order,
      role,
      divisionsKey,
      hasLogs,
      minEncounters
    ),
    queryFn: ({ signal }) =>
      userService.getUsersOverview({
        discipline: game,
        page,
        perPage,
        sort,
        order,
        query: query || undefined,
        role: roleFilter,
        divisions,
        hasLogs,
        minEncounters,
        workspaceId,
        signal
      }),
    placeholderData: sameGame,
    staleTime: 30_000,
    enabled: view === "table" && ready
  });

  const statsQuery = useQuery({
    queryKey: userQueryKeys.overviewStats(workspaceId, game, query, role, divisionsKey, hasLogs),
    queryFn: ({ signal }) =>
      userService.getUsersOverviewStats({
        discipline: game,
        query: query || undefined,
        role: roleFilter,
        divisions,
        hasLogs,
        workspaceId,
        signal
      }),
    placeholderData: sameGame,
    staleTime: 30_000,
    enabled: ready
  });

  const catalogQuery = useQuery({
    queryKey: userQueryKeys.overviewCatalog(workspaceId, game, query, role, divisionsKey, hasLogs, letter),
    queryFn: ({ signal }) =>
      userService.getUsersCatalog({
        discipline: game,
        query: query || undefined,
        role: roleFilter,
        // A pinned letter is the "show more" affordance: one bucket, deeper.
        perLetter: letter ? 48 : 12,
        hasLogs,
        letter,
        maxLetters: 27,
        workspaceId,
        signal
      }),
    placeholderData: sameGame,
    staleTime: 30_000,
    enabled: view === "catalog" && ready
  });

  const data = overviewQuery.data;
  const maxPage = useMemo(() => {
    if (!data || data.per_page <= 0) return 1;
    return Math.max(1, Math.ceil(data.total / data.per_page));
  }, [data]);

  const range = useMemo(() => {
    if (!data || data.results.length === 0) return null;
    const start = (data.page - 1) * data.per_page + 1;
    return { start, end: start + data.results.length - 1 };
  }, [data]);

  const availableLetters = useMemo(
    () => new Set(catalogQuery.data?.available_letters ?? []),
    [catalogQuery.data]
  );

  return {
    overviewQuery,
    statsQuery,
    catalogQuery,
    maxPage,
    range,
    availableLetters,
    workspaceId,
    discipline,
    ontology: metadata
  };
}
