"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useRealtimeTopic } from "@/hooks/useRealtimeTopic";
import { notificationQueryKeys } from "@/lib/notification-query-keys";
import notificationService from "@/services/notification.service";
import type { NotificationItem } from "@/types/notification.types";

interface UseNotificationsResult {
  items: NotificationItem[];
  unreadCount: number;
  isLoading: boolean;
  markAllRead: () => void;
  isMarkingRead: boolean;
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

  const query = useQuery({
    queryKey: notificationQueryKeys.list(),
    queryFn: () => notificationService.list(),
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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: notificationQueryKeys.list() });
      // Read marks are dismissals: the same rows drive the announcement banner,
      // so leaving its cache alone would keep showing a dismissed announcement
      // until the next reload.
      void queryClient.invalidateQueries({ queryKey: notificationQueryKeys.activeAnnouncements() });
    }
  });

  return {
    items: query.data?.items ?? [],
    unreadCount: query.data?.unread_count ?? 0,
    isLoading: enabled && query.isPending,
    markAllRead: () => markRead.mutate(undefined),
    isMarkingRead: markRead.isPending
  };
}
