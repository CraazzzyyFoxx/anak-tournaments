"use client";

import { useQueries, useQueryClient, type Query } from "@tanstack/react-query";
import { useState } from "react";

import {
  customGameKeys,
  customGameService,
  type CustomGameListItem,
  type MixListFilter,
  type MixListPage,
} from "@/services/custom-game.service";

const HISTORY_PAGE_SIZE = 30;

/** Where the next page starts: below `before`, from every community not in `done`. */
export type HistoryCursor = { before: number | null; done: number[] };

/**
 * One page of the directory across several communities, each paged on its own.
 *
 * Mix ids are global and every community answers newest first, so the pages
 * merge by id -- but only down to the highest point any community stopped at:
 * below that, a community that still has more could own a newer mix than the
 * ones already fetched. Rows under that frontier are held back and fetched
 * again as the top of the next page, so a row never appears and then gets a
 * newer one inserted above it. A community that answered everything it had
 * above the frontier is `done` and is not asked again.
 */
export function mergeHistoryPage(
  sources: readonly { workspaceId: number; page: MixListPage }[],
  done: readonly number[]
): { items: CustomGameListItem[]; next: HistoryCursor | null } {
  const open = sources.filter((source) => source.page.next_before_id != null);
  const frontier = open.length > 0 ? Math.max(...open.map((source) => source.page.next_before_id as number)) : null;
  const items = sources
    .flatMap((source) => source.page.items)
    .filter((item) => frontier === null || item.id >= frontier)
    .sort((a, b) => b.id - a.id);
  if (frontier === null) return { items, next: null };
  const finished = sources
    .filter((source) => source.page.next_before_id == null && source.page.items.every((item) => item.id >= frontier))
    .map((source) => source.workspaceId);
  return { items, next: { before: frontier, done: [...done, ...finished] } };
}

function historyFilter(q: string, before: number | null): MixListFilter {
  return { status: "history", q, limit: HISTORY_PAGE_SIZE, before_id: before };
}

/**
 * Finished mixes of several communities, newest first, a page at a time.
 *
 * Every request is one community's own page under that community's list key,
 * so a realtime `pickup_mix` invalidation or a create refreshes exactly the
 * pages it touched. The cursor of page N+1 is derived from page N's cached
 * answer on every render rather than stored, so a refetch that shifts page N
 * re-derives everything after it instead of leaving a gap.
 */
export function useMixHistory({
  workspaceIds,
  discipline,
  q,
  enabled,
}: Readonly<{ workspaceIds: number[]; discipline: string | null; q: string; enabled: boolean }>) {
  const queryClient = useQueryClient();
  const [pageCount, setPageCount] = useState(1);
  // A new filter starts over at the first page (React's own reset-on-prop pattern).
  const filterKey = `${workspaceIds.join(",")}|${discipline ?? ""}|${q}`;
  const [shownFor, setShownFor] = useState(filterKey);
  if (shownFor !== filterKey) {
    setShownFor(filterKey);
    setPageCount(1);
  }

  const chain: (HistoryCursor & { workspaceIds: number[] })[] = [];
  let cursor: HistoryCursor | null = { before: null, done: [] };
  while (cursor !== null && chain.length < pageCount) {
    const current: HistoryCursor = cursor;
    const asked = workspaceIds.filter((id) => !current.done.includes(id));
    chain.push({ ...current, workspaceIds: asked });
    const pages = asked.map((id) =>
      queryClient.getQueryData<MixListPage>(customGameKeys.list(id, discipline, historyFilter(q, current.before)))
    );
    if (pages.some((page) => page === undefined)) break;
    cursor = mergeHistoryPage(
      asked.map((id, index) => ({ workspaceId: id, page: pages[index] as MixListPage })),
      current.done
    ).next;
  }

  const results = useQueries({
    queries: chain.flatMap((link, pageIndex) =>
      link.workspaceIds.map((id) => ({
        queryKey: customGameKeys.list(id, discipline, historyFilter(q, link.before)),
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          customGameService.list(id, discipline, historyFilter(q, link.before), { signal }),
        enabled,
        // Only a new search of the same community and game keeps the previous rows on screen while it loads; another
        // game's or community's rows never stand in for this one's.
        placeholderData: (previous: MixListPage | undefined, previousQuery: Query | undefined) =>
          pageIndex === 0 &&
          previousQuery?.queryKey[1] === id &&
          previousQuery.queryKey[3] === (discipline ?? "all")
            ? previous
            : undefined,
      }))
    ),
  });

  const items: CustomGameListItem[] = [];
  let next: HistoryCursor | null = null;
  let offset = 0;
  let pendingPage = false;
  for (const link of chain) {
    const slice = results.slice(offset, offset + link.workspaceIds.length);
    offset += link.workspaceIds.length;
    if (slice.some((result) => result.data === undefined)) {
      pendingPage = true;
      break;
    }
    const merged = mergeHistoryPage(
      link.workspaceIds.map((id, index) => ({ workspaceId: id, page: slice[index].data as MixListPage })),
      link.done
    );
    items.push(...merged.items);
    next = merged.next;
  }

  const firstPage = results.slice(0, chain[0]?.workspaceIds.length ?? 0);
  return {
    items,
    loading: enabled && firstPage.some((result) => result.data === undefined && !result.isError),
    /** The list on screen still answers the previous search. */
    updating: firstPage.some((result) => result.isPlaceholderData),
    loadingMore: chain.length > 1 && pendingPage && !results.some((result) => result.isError),
    error: results.some((result) => result.isError),
    hasMore: !pendingPage && next !== null,
    loadMore: () => setPageCount((count) => count + 1),
    retry: () => {
      for (const result of results) if (result.isError) void result.refetch();
    },
  };
}
