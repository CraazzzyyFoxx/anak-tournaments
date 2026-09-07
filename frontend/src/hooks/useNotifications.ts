"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { useRealtimeTopic } from "@/hooks/useRealtimeTopic";
import { notificationQueryKeys } from "@/lib/notification-query-keys";
import notificationService from "@/services/notification.service";
import type { NotificationItem } from "@/types/notification.types";

interface UseNotificationsResult {
  items: NotificationItem[];
  unreadCount: number | null;
  isLoading: boolean;
  hasData: boolean;
  isError: boolean;
  isFetching: boolean;
  retry: () => void;
  markAllRead: () => void;
  markOneRead: (id: number) => void;
  isMarkingRead: boolean;
  markingId: number | null;
  markReadStatus: "idle" | "pending" | "error" | "success";
  retryMarkRead: () => void;
  /** Another page exists behind `next_cursor`. */
  hasMore: boolean;
  loadMore: () => void;
  isLoadingMore: boolean;
  isLoadMoreError: boolean;
}

/**
 * The inbox behind the bell: one query for the page *and* the badge count, and
 * the personal realtime topic that tells it to refetch.
 *
 * `authUserId` is the identity's own id and nothing else — the gateway ACL for
 * `user:<id>:notifications` has no superuser bypass, so a wrong id is a
 * subscription that is rejected on every reconnect. `null` (anonymous) means no
 * request and no subscription at all.
 */
export function useNotifications(authUserId: number | null | undefined): UseNotificationsResult {
  const queryClient = useQueryClient();
  const enabled = authUserId != null;

  // Paged, not a single read: the server answers 20 rows and an opaque
  // `next_cursor`, so a plain query would make everything older than the 20th
  // notification unreachable — there is no other surface it exists on.
  const query = useInfiniteQuery({
    queryKey: notificationQueryKeys.list(),
    queryFn: ({ pageParam }) => notificationService.list({ cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    meta: { suppressErrorToast: true },
    enabled
  });

  // `notification.created` is a thin signal: no payload, no replay cursor
  // (`event_id: 0`). Refetching is therefore the only correct reaction — there
  // is nothing in the event to patch the cache with.
  useRealtimeTopic(enabled ? `user:${authUserId}:notifications` : null, () => {
    void queryClient.invalidateQueries({ queryKey: notificationQueryKeys.list() });
  });

  const markRead = useMutation({
    mutationFn: (ids?: number[]) => notificationService.markRead(ids),
    meta: { suppressErrorToast: true },
    onSuccess: async () => {
      // Stay pending until both surfaces reflect the dismissal. A failed
      // refresh must not announce success against stale unread rows.
      const results = await Promise.allSettled([
        queryClient.invalidateQueries(
          { queryKey: notificationQueryKeys.list() },
          { throwOnError: true }
        ),
        queryClient.invalidateQueries(
          { queryKey: notificationQueryKeys.activeAnnouncements() },
          { throwOnError: true }
        )
      ]);
      for (const result of results) {
        if (result.status === "rejected") throw result.reason;
      }
    }
  });

  return {
    // Pages arrive newest-first and keyset-paginated, so concatenation is the
    // order — no re-sort, and no row can appear twice.
    items: query.data?.pages.flatMap((page) => page.items) ?? [],
    // The badge counts the whole inbox, not the loaded prefix: every page
    // carries the same total, so the first one answers it.
    unreadCount: query.data?.pages[0]?.unread_count ?? null,
    isLoading: enabled && query.isPending,
    hasData: query.data !== undefined,
    isError: query.isError && !query.isFetchNextPageError,
    isFetching: query.isFetching,
    retry: () => {
      if (!query.isFetching) void query.refetch();
    },
    markAllRead: () => {
      if (!markRead.isPending) markRead.mutate(undefined);
    },
    markOneRead: (id) => {
      if (!markRead.isPending) markRead.mutate([id]);
    },
    isMarkingRead: markRead.isPending,
    markingId: markRead.variables?.[0] ?? null,
    markReadStatus: markRead.status,
    retryMarkRead: () => {
      if (!markRead.isPending) markRead.mutate(markRead.variables);
    },
    hasMore: query.hasNextPage,
    loadMore: () => {
      if (query.hasNextPage && !query.isFetching && !markRead.isPending) {
        void query.fetchNextPage({ cancelRefetch: false });
      }
    },
    isLoadingMore: query.isFetchingNextPage,
    isLoadMoreError: query.isFetchNextPageError
  };
}
