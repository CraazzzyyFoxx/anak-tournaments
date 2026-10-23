"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useDebouncedCallback } from "use-debounce";

import { ALL_DISCIPLINES, DISCIPLINE_PARAM } from "@/lib/site/discipline-scope";

import {
  filtersToSearchParams,
  GAME_SCOPED_FILTERS,
  readEncountersUrl,
  sameFilters,
  type EncounterFilterState,
  type EncountersUrlState,
  type EncountersView
} from "./encounters.helpers";

export interface EncountersFilterControls {
  /** Raw (undebounced) filter state — what the controls are bound to. */
  filters: EncounterFilterState;
  /**
   * `filters` with the search term folded in once typing settles and, under every game,
   * no tournament/stage — what the queries read.
   */
  effectiveFilters: EncounterFilterState;
  searchValue: string;
  page: number;
  view: EncountersView;
  /** Another page of the list: its own history entry, so Back returns to the page before. */
  setPage: (page: number) => void;
  setView: (view: EncountersView) => void;
  setSearchValue: (value: string) => void;
  /** Patch a few fields and return to page 1. */
  patchFilters: (patch: Partial<EncounterFilterState>) => void;
  /** Replace the whole filter state (a saved view, a reset) and return to page 1. */
  applyFilters: (next: EncounterFilterState) => void;
}

/** What the filter state belongs to once the page showed no readable game: whatever follows reads the URL afresh. */
const UNAVAILABLE = Symbol("unavailable");

/**
 * Filter/search/page/view state for the encounters index, mirrored into the URL.
 *
 * The mirror writes history directly, not through the router: the page re-renders off the query cache either way.
 * A filter, the search or the view replaces the current entry (a push per keystroke would bury Back); another page
 * of the list pushes one, and Back/Forward (`popstate`) read the URL again. The previous-value ref keeps the very
 * first render (which already matches the server-rendered URL) from writing a redundant entry. The game is the
 * scope's, not a filter: the mirror keeps an explicit `?discipline=` as it found it and never adds one. `gameKey` is
 * the page's readable game — "all" or a code; `null` while resolving and while `unavailable` (an invalid request, or
 * no game at all). Another game starts again from its first page without the old game's tournament/stage filters.
 * Leaving an unavailable state, the URL is the truth: page, view, filters and search are read from it again and take
 * effect at once — a recovery pushed one without the old game's page and tournament/stage, Back restores them — and
 * nothing is written back. Only a readable game is mirrored, so an invalid request's URL stays as typed (spec §4.1).
 * Under every game the tournament/stage filters never take effect at all, whatever put them in the state (the URL, a
 * saved view): nothing reads or mirrors them.
 */
export function useEncountersFilters(
  initial: EncountersUrlState,
  gameKey: string | null,
  unavailable: boolean
): EncountersFilterControls {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const explicitGame = searchParams?.get(DISCIPLINE_PARAM) ?? null;
  const [filters, setFilters] = useState<EncounterFilterState>(initial.filters);
  const [searchValue, setSearchInput] = useState(initial.filters.query);
  // The term the reads use: typing reaches it once it settles, a reading of the URL at once.
  const [query, setQuery] = useState(initial.filters.query);
  const settleQuery = useDebouncedCallback(setQuery, 300);
  const [page, setPageState] = useState(initial.page);
  const [view, setView] = useState(initial.view);
  // What the URL says the state is: the server's reading of it, or the last reading since.
  const [urlState, setUrlState] = useState(initial);
  const [stateGame, setStateGame] = useState<string | typeof UNAVAILABLE | null>(
    unavailable ? UNAVAILABLE : gameKey
  );
  // The next mirror write is a page turn: a history entry of its own.
  const pushNext = useRef(false);

  const adopt = (read: EncountersUrlState) => {
    setUrlState(read);
    setPageState(read.page);
    setView(read.view);
    setSearchInput(read.filters.query);
    setQuery(read.filters.query);
    setFilters(read.filters);
  };

  if (unavailable && stateGame !== UNAVAILABLE) setStateGame(UNAVAILABLE);
  if (gameKey !== null && gameKey !== stateGame) {
    setStateGame(gameKey);
    if (stateGame === UNAVAILABLE) {
      adopt(readEncountersUrl(Object.fromEntries(searchParams ?? [])));
    } else if (stateGame !== null) {
      setPageState(1);
      setFilters((current) => ({ ...current, ...GAME_SCOPED_FILTERS }));
    }
  }
  const previousUrlRef = useRef(urlState);
  const effectiveFilters = useMemo(
    () => ({
      ...filters,
      query,
      ...(gameKey === ALL_DISCIPLINES ? GAME_SCOPED_FILTERS : null)
    }),
    [query, filters, gameKey]
  );

  // A reading of the URL is what the URL already says: the mirror compares against it, not against an older write.
  useEffect(() => {
    previousUrlRef.current = urlState;
  }, [urlState]);

  // A term still settling when the page lost its game is dropped: what follows reads the term from the URL.
  useEffect(() => {
    if (unavailable) settleQuery.cancel();
  }, [unavailable, settleQuery]);

  // Back/Forward across this page's own entries: the URL is the state again, a pending term included.
  const restore = useEffectEvent(() => {
    settleQuery.cancel();
    adopt(readEncountersUrl(Object.fromEntries(new URLSearchParams(window.location.search))));
  });
  useEffect(() => {
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  const typeSearch = (value: string) => {
    setSearchInput(value);
    settleQuery(value);
  };

  useEffect(() => {
    if (gameKey === null) return;
    const push = pushNext.current;
    pushNext.current = false;
    const previous = previousUrlRef.current;
    if (previous.page === page && previous.view === view && sameFilters(previous.filters, effectiveFilters)) return;

    const params = filtersToSearchParams(effectiveFilters, page, view);
    if (explicitGame !== null) params.set(DISCIPLINE_PARAM, explicitGame);
    const search = params.toString();
    const nextUrl = search ? `${pathname}?${search}` : pathname;
    if (push) window.history.pushState(null, "", nextUrl);
    else window.history.replaceState(null, "", nextUrl);
    previousUrlRef.current = { page, view, filters: effectiveFilters };
  }, [gameKey, explicitGame, effectiveFilters, page, view, pathname]);

  return {
    filters,
    effectiveFilters,
    searchValue,
    page,
    view,
    setPage: (next) => {
      if (next === page) return;
      pushNext.current = true;
      setPageState(next);
    },
    setView,
    setSearchValue: (value) => {
      setPageState(1);
      typeSearch(value);
    },
    patchFilters: (patch) => {
      setPageState(1);
      setFilters((current) => ({ ...current, ...patch }));
    },
    applyFilters: (next) => {
      // A whole filter set lands at once: no read of it with the previous term while a debounce runs.
      settleQuery.cancel();
      setSearchInput(next.query);
      setQuery(next.query);
      setPageState(1);
      setFilters(next);
    }
  };
}
