"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useDebounce } from "use-debounce";

import { useQueryParams } from "@/hooks/useQueryParams";
import { useDivisionGrid } from "@/hooks/useCurrentWorkspace";
import { clampDivisionToGrid } from "@/lib/divisions/grid";
import type { StatsScope } from "@/lib/site/stats-scope";
import { parsePositiveInt } from "@/app/(site)/users/components/shared/list-utils";
import type { DisciplineMetadata } from "@/types/discipline.types";
import type { DivisionGrid } from "@/types/workspace.types";

import {
  DEFAULT_MIN_ENCOUNTERS,
  PER_PAGE_OPTIONS,
  defaultOrderFor,
  parseDivisions,
  parseMinEncounters,
  parseOrder,
  parsePerPage,
  parseRoleChip,
  parseSort,
  parseView,
  type OrderValue,
  type SortValue,
  type ViewMode
} from "./users-index.model";

export interface UsersIndexParams {
  page: number;
  perPage: number;
  query: string;
  sort: SortValue;
  order: OrderValue;
  view: ViewMode;
  /** A rated role code of the game, or the open slot (`flex`); `undefined` lists every player. */
  role: string | undefined;
  /** Division numbers from `?div=3,5,7`; empty means no division filter. */
  divisions: number[];
  /** `?logs=1`: only players with parsed match logs. */
  hasLogs: boolean;
  /** Winrate sample floor; below it a player sorts last and its WR reads faint. */
  minEncounters: number;
  letter: string | undefined;
  /** Resolved server-side: `all` reads every workspace (platform apex only). */
  scope: StatsScope;
}

export interface UsersIndexParamControls {
  params: UsersIndexParams;
  /** The grid the division facet and `?div=` are read against. */
  divisionGrid: DivisionGrid;
  /** Live search box value; the URL only follows it once typing settles. */
  searchInput: string;
  setSearchInput: (value: string) => void;
  setRole: (value: string | undefined) => void;
  setDivisions: (value: number[]) => void;
  setHasLogs: (value: boolean) => void;
  setMinEncounters: (value: number) => void;
  /** Applies a column sort: same column flips the direction, a new one starts at its default. */
  toggleSort: (value: SortValue) => void;
  setView: (value: ViewMode) => void;
  setLetter: (value: string | null) => void;
  setPage: (value: number) => void;
  setPerPage: (value: number) => void;
  /** Any filter narrowing the list (not sort, paging or the view). */
  hasActiveFilters: boolean;
  resetFilters: () => void;
}

/**
 * The users index keeps every filter in the URL, so a link reproduces the
 * screen. `useQueryParams` already resets `page` whenever any other param
 * changes, so paging passes only `page` and is left alone.
 */
export function useUsersIndexParams(
  scope: StatsScope,
  /** The browsed game; `null` while unresolved. */
  discipline: string | null,
  /** Its metadata; `null` while it loads — an explicit `?role=` is kept as typed until then. */
  metadata: DisciplineMetadata | null
): UsersIndexParamControls {
  const { searchParams, setParams } = useQueryParams();
  const workspaceGrid = useDivisionGrid(discipline ?? undefined);
  // All-workspaces divisions span every grid, so the filter is plain tier numbers of the game's own native
  // ladder (none → no division facet) rather than this workspace's grid — never another game's ladder.
  const divisionGrid = useMemo(
    () => (scope === "all" ? { tiers: [...(metadata?.native_ladder ?? [])] } : workspaceGrid),
    [scope, metadata, workspaceGrid]
  );
  const rawRole = searchParams?.get("role") ?? null;

  const query = searchParams?.get("query") ?? "";
  const sort = parseSort(searchParams?.get("sort") ?? null);
  const divisions = parseDivisions(searchParams?.get("div") ?? null).filter(
    (division) => clampDivisionToGrid(divisionGrid, division) === division
  );
  const params: UsersIndexParams = {
    page: parsePositiveInt(searchParams?.get("page") ?? null, 1),
    perPage: parsePerPage(searchParams?.get("per_page") ?? null),
    query,
    sort,
    order: parseOrder(searchParams?.get("order") ?? null, sort),
    view: parseView(searchParams?.get("view") ?? null),
    role: metadata ? parseRoleChip(metadata, rawRole) : (rawRole ?? undefined),
    divisions,
    hasLogs: searchParams?.get("logs") === "1",
    minEncounters: parseMinEncounters(searchParams?.get("min_encounters") ?? null),
    letter: searchParams?.get("letter") ?? undefined,
    scope
  };

  const [searchInput, setSearchInput] = useState(query);
  const [debouncedSearch] = useDebounce(searchInput, 300);

  useEffect(() => {
    setSearchInput(query);
  }, [query]);

  useEffect(() => {
    const normalizedInput = debouncedSearch.trim();
    const normalizedQuery = query.trim();
    if (normalizedInput === normalizedQuery) return;
    setParams({ query: normalizedInput || undefined });
  }, [debouncedSearch, query, setParams]);

  const resetFilters = useCallback(() => {
    setParams({
      query: undefined,
      role: undefined,
      div: undefined,
      logs: undefined,
      letter: undefined,
      min_encounters: undefined
    });
  }, [setParams]);

  return {
    params,
    divisionGrid,
    searchInput,
    setSearchInput,
    setRole: (value) => setParams({ role: value }),
    setDivisions: (value) =>
      setParams({
        div: value.length === 0 ? undefined : [...value].sort((a, b) => a - b).join(",")
      }),
    setHasLogs: (value) => setParams({ logs: value ? "1" : undefined }),
    // The default is implied, never written: a shared link should not carry a
    // param the user never touched.
    setMinEncounters: (value) =>
      setParams({ min_encounters: value === DEFAULT_MIN_ENCOUNTERS ? undefined : value }),
    toggleSort: (value) =>
      setParams(
        value === params.sort
          ? { order: params.order === "asc" ? "desc" : "asc" }
          : { sort: value, order: defaultOrderFor(value) }
      ),
    setView: (value) => setParams({ view: value === "table" ? undefined : value }),
    setLetter: (value) => setParams({ letter: value === null ? undefined : value }),
    setPage: (value) => setParams({ page: value }),
    setPerPage: (value) =>
      setParams({ per_page: value === PER_PAGE_OPTIONS[0] ? undefined : value }),
    hasActiveFilters:
      query.trim().length > 0 ||
      params.role !== undefined ||
      divisions.length > 0 ||
      params.hasLogs ||
      params.letter !== undefined,
    resetFilters
  };
}
