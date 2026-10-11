"use client";

import { useMemo } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import userService from "@/services/user.service";
import { userQueryKeys } from "@/lib/users/query-keys";
import { useCurrentWorkspaceId } from "@/hooks/useCurrentWorkspace";
import type { UserCatalogResponse, UserOverviewResponse, UserOverviewStats } from "@/types/user.types";

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
}

/**
 * The three reads behind the index. Only the view on screen pays for its own
 * list — the stats strip is shared by both, so it always runs.
 */
export function useUsersIndexData(params: UsersIndexParams): UsersIndexData {
  const currentWorkspaceId = useCurrentWorkspaceId();
  const { page, perPage, query, sort, order, role, divisions, hasLogs, minEncounters, letter, view, scope } =
    params;
  // One value carries the workspace dimension of every read and every key:
  // a workspace id, or the backend's cross-workspace sentinel.
  const workspaceId = scope === "all" ? "all" : currentWorkspaceId;
  // Query keys take scalars only, and the array identity changes every render.
  const divisionsKey = divisions.join(",");

  const overviewQuery = useQuery({
    queryKey: userQueryKeys.overview(
      workspaceId,
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
    queryFn: () =>
      userService.getUsersOverview({
        page,
        perPage,
        sort,
        order,
        query: query || undefined,
        role,
        divisions,
        hasLogs,
        minEncounters,
        workspaceId
      }),
    placeholderData: (previousData) => previousData,
    staleTime: 30_000,
    enabled: view === "table"
  });

  const statsQuery = useQuery({
    queryKey: userQueryKeys.overviewStats(workspaceId, query, role, divisionsKey, hasLogs),
    queryFn: () =>
      userService.getUsersOverviewStats({
        query: query || undefined,
        role,
        divisions,
        hasLogs,
        workspaceId
      }),
    placeholderData: (previousData) => previousData,
    staleTime: 30_000
  });

  const catalogQuery = useQuery({
    queryKey: userQueryKeys.overviewCatalog(workspaceId, query, role, divisionsKey, hasLogs, letter),
    queryFn: () =>
      userService.getUsersCatalog({
        query: query || undefined,
        role,
        // A pinned letter is the "show more" affordance: one bucket, deeper.
        perLetter: letter ? 48 : 12,
        hasLogs,
        letter,
        maxLetters: 27,
        workspaceId
      }),
    placeholderData: (previousData) => previousData,
    staleTime: 30_000,
    enabled: view === "catalog"
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

  return { overviewQuery, statsQuery, catalogQuery, maxPage, range, availableLetters, workspaceId };
}
