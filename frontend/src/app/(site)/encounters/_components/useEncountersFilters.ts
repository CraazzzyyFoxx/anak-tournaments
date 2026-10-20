"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useDebounce } from "use-debounce";

import { ALL_DISCIPLINES, DISCIPLINE_PARAM } from "@/lib/site/discipline-scope";

import {
  DEFAULT_FILTERS,
  filtersToSearchParams,
  GAME_SCOPED_FILTERS,
  type EncounterFilterState
} from "./encounters.helpers";

export interface EncountersFilterControls {
  /** Raw (undebounced) filter state — what the controls are bound to. */
  filters: EncounterFilterState;
  /**
   * `filters` with the debounced search term folded in and, under every game, no
   * tournament/stage — what the queries read.
   */
  effectiveFilters: EncounterFilterState;
  searchValue: string;
  page: number;
  setPage: (page: number) => void;
  setSearchValue: (value: string) => void;
  /** Patch a few fields and return to page 1. */
  patchFilters: (patch: Partial<EncounterFilterState>) => void;
  /** Replace the whole filter state (built-in view, saved view) and return to page 1. */
  applyFilters: (next: EncounterFilterState) => void;
  clearFilters: () => void;
}

/** What the filter state belongs to once the page showed no readable game: any game that follows starts afresh. */
const UNAVAILABLE = Symbol("unavailable");

/**
 * Filter/search/page state for the encounters index, mirrored into the URL.
 *
 * The mirror is a `replaceState`, not a router navigation: the page re-renders
 * off the query cache either way, and a push would stack one history entry per
 * keystroke. The previous-value ref keeps the very first render (which already
 * matches the server-rendered URL) from writing a redundant entry. The game is the
 * scope's, not a filter: the mirror keeps an explicit `?discipline=` as it found it and
 * never adds one. `gameKey` is the page's readable game — "all" or a code; `null` while
 * resolving and while `unavailable` (an invalid request, or no game at all). Arriving at
 * a game from another one, or from an unavailable state (even back at the game before
 * it), starts again from its first page without the old game's tournament/stage
 * filters. Only a readable game is mirrored, so an invalid request's URL stays as typed
 * (spec §4.1). Under every game those filters never take effect at all, whatever put
 * them in the state (the URL, a saved view): nothing reads or mirrors them.
 */
export function useEncountersFilters(
  initialFilters: EncounterFilterState,
  initialPage: number,
  gameKey: string | null,
  unavailable: boolean
): EncountersFilterControls {
  const pathname = usePathname();
  const explicitGame = useSearchParams()?.get(DISCIPLINE_PARAM) ?? null;
  const [filters, setFilters] = useState<EncounterFilterState>(initialFilters);
  const [searchValue, setSearchInput] = useState(initialFilters.query);
  const [debouncedSearch] = useDebounce(searchValue, 300);
  const [page, setPage] = useState(initialPage);
  const [stateGame, setStateGame] = useState<string | typeof UNAVAILABLE | null>(
    unavailable ? UNAVAILABLE : gameKey
  );
  if (unavailable && stateGame !== UNAVAILABLE) setStateGame(UNAVAILABLE);
  if (gameKey !== null && gameKey !== stateGame) {
    setStateGame(gameKey);
    if (stateGame !== null) {
      setPage(1);
      setFilters((current) => ({ ...current, ...GAME_SCOPED_FILTERS }));
    }
  }
  const previousUrlRef = useRef({ page: initialPage, filters: initialFilters });
  const effectiveFilters = useMemo(
    () => ({
      ...filters,
      query: debouncedSearch,
      ...(gameKey === ALL_DISCIPLINES ? GAME_SCOPED_FILTERS : null)
    }),
    [debouncedSearch, filters, gameKey]
  );

  useEffect(() => {
    if (gameKey === null) return;
    const params = filtersToSearchParams(effectiveFilters, page);
    if (explicitGame !== null) params.set(DISCIPLINE_PARAM, explicitGame);
    const nextUrl = `${pathname}?${params.toString()}`;
    const previous = previousUrlRef.current;
    if (
      previous.page === page &&
      JSON.stringify(previous.filters) === JSON.stringify(effectiveFilters)
    ) {
      return;
    }

    window.history.replaceState(null, "", nextUrl);
    previousUrlRef.current = { page, filters: effectiveFilters };
  }, [gameKey, explicitGame, effectiveFilters, page, pathname]);

  return {
    filters,
    effectiveFilters,
    searchValue,
    page,
    setPage,
    setSearchValue: (value) => {
      setPage(1);
      setSearchInput(value);
    },
    patchFilters: (patch) => {
      setPage(1);
      setFilters((current) => ({ ...current, ...patch }));
    },
    applyFilters: (next) => {
      setPage(1);
      setSearchInput(next.query);
      setFilters(next);
    },
    clearFilters: () => {
      setSearchInput("");
      setPage(1);
      setFilters(DEFAULT_FILTERS);
    }
  };
}
