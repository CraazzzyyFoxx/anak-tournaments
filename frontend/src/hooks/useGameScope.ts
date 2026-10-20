"use client";

import { useCallback, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { useDisciplines } from "@/hooks/useDisciplineMetadata";
import {
  ALL_DISCIPLINES,
  DISCIPLINE_PARAM,
  pageClassOf,
  resolvePageGame,
  resolveWorkspaceAxis,
  type GameScope,
  type GameScopeInit,
  type PageClass,
  type PageGameResolution,
  type WorkspaceAxis
} from "@/lib/site/discipline-scope";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type { DisciplineDescriptor } from "@/types/discipline.types";

export interface GameScopeState {
  axis: WorkspaceAxis;
  /** The candidate games after `filter`; `undefined` until the list is known. */
  games: DisciplineDescriptor[] | undefined;
  /** `null` until the list is known; invalid/empty resolutions make no game request. */
  resolution: PageGameResolution | null;
  game: string | null;
  isError: boolean;
  refetch: () => void;
  /** A pill pick (spec §4.4): saves the scope (and a game as the last game) and pushes it to the URL. */
  selectScope: (value: GameScope, options?: { dropParams?: string[] }) => void;
  /** A local tab pick: saves the last game; on a single/platform page also pushes it to the URL. */
  selectTab: (code: string, options?: { url?: boolean; dropParams?: string[] }) => void;
}

const noSubscription = () => () => {};

/**
 * The game a page reads, what the scope pill shows and whether local tabs appear (spec §4), from
 * the saved scope, the last game, `?discipline=` and the area's games. Nothing is written on
 * landing; only a pick writes. Until mounted the server's own inputs (`initial`) drive the
 * resolution, so hydration matches the server render.
 */
export function useGameScope(
  options: {
    pageClass?: PageClass;
    initial?: GameScopeInit;
    /** A page that is platform-wide (`all`) or about one community (its id); a tenant lock still wins. */
    axis?: WorkspaceAxis;
    ownerGame?: string | null;
    /** The owner is named in the URL but not loaded yet. */
    ownerPending?: boolean;
    /** Narrows the candidates: a capability, or a player's games ordered by tournaments. */
    filter?: (games: DisciplineDescriptor[]) => DisciplineDescriptor[];
  } = {}
): GameScopeState {
  const { initial, axis: axisOverride, ownerGame = null, ownerPending = false, filter } = options;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const mounted = useSyncExternalStore(noSubscription, () => true, () => false);
  const pageClass = options.pageClass ?? pageClassOf(pathname);

  const storeHostLock = useWorkspaceStore((s) => s.hostLockedWorkspaceId);
  const statsScope = useWorkspaceStore((s) => s.statsScope);
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const storeScope = useWorkspaceStore((s) => s.gameScope);
  const storeLastGame = useWorkspaceStore((s) => s.lastGame);
  const setGameScope = useWorkspaceStore((s) => s.setGameScope);
  const setLastGame = useWorkspaceStore((s) => s.setLastGame);

  const server = mounted ? undefined : initial;
  const stored = server ? server.stored : storeScope;
  const lastGame = server ? server.lastGame : storeLastGame;
  const tenantLock = storeHostLock ?? initial?.hostLockedWorkspaceId ?? null;
  const viewed = server
    ? server.axis
    : resolveWorkspaceAxis({ hostLockedWorkspaceId: tenantLock, ownerWorkspaceId: null, statsScope, currentWorkspaceId });
  // A tenant host's workspace is authoritative: a platform-wide override never widens it.
  const axis = tenantLock ?? axisOverride ?? viewed;

  const list = useDisciplines(axis, initial?.axis === axis ? (initial.disciplines ?? undefined) : undefined);
  const games = list.data && filter ? filter(list.data) : list.data;
  // `?discipline=` with no value is an explicit (invalid) request, not an absent one.
  const explicit = searchParams.get(DISCIPLINE_PARAM);
  const resolution = games
    ? resolvePageGame({ pageClass, ownerGame: ownerPending ? null : ownerGame, explicit, stored, lastGame, games })
    : null;

  const push = useCallback(
    (mutate: (next: URLSearchParams) => void, dropParams: readonly string[] = []) => {
      const next = new URLSearchParams(searchParams.toString());
      mutate(next);
      next.delete("page");
      for (const param of dropParams) next.delete(param);
      const query = next.toString();
      router.push(query ? `${pathname}?${query}` : pathname);
      // Every push follows a cookie write. The client cache keys renders by URL, not cookie (`staleTimes.dynamic`), so the
      // push alone can re-show a render made under the previous cookies (a param-less URL, the page itself). The refresh
      // is queued behind the push and re-reads the server tree on the new URL, without a history entry of its own.
      // ponytail: a URL the cache lacks is fetched twice (push, then refresh); one fetch needs a pre-navigation cache drop
      // Next does not offer.
      router.refresh();
    },
    [pathname, router, searchParams]
  );

  const selectScope = useCallback(
    (value: GameScope, choice?: { dropParams?: string[] }) => {
      setGameScope(value);
      if (value !== ALL_DISCIPLINES) setLastGame(value);
      push((next) => {
        if (value === ALL_DISCIPLINES) next.delete(DISCIPLINE_PARAM);
        else next.set(DISCIPLINE_PARAM, value);
      }, choice?.dropParams);
    },
    [push, setGameScope, setLastGame]
  );

  const selectTab = useCallback(
    (code: string, choice?: { url?: boolean; dropParams?: string[] }) => {
      setLastGame(code);
      if (choice?.url === false) return;
      push((next) => next.set(DISCIPLINE_PARAM, code), choice?.dropParams);
    },
    [push, setLastGame]
  );

  return {
    axis,
    games,
    resolution,
    game: resolution?.game.kind === "game" ? resolution.game.code : null,
    isError: list.isError,
    refetch: () => void list.refetch(),
    selectScope,
    selectTab
  };
}
