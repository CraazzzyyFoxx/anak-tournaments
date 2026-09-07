/**
 * Query keys for the inbox and the announcement banner, in one place for the
 * same reason `tournament-query-keys.ts` exists: the realtime signal and the
 * mark-read mutation both invalidate what the bell reads, and a key spelled
 * twice is a bell that silently stops updating.
 *
 * No user id in the inbox key: the server scopes the page from the token, and a
 * per-user key would imply the cache could legitimately hold another account's
 * notifications. It is cleared with the rest of the authenticated cache on
 * sign-out. No separate unread-count key either — the count ships inside the
 * same response the list does, so a second key would be a second request for
 * data already in hand.
 */
export const notificationQueryKeys = {
  list: () => ["notifications"] as const,
  activeAnnouncements: () => ["announcements", "active"] as const,
  /**
   * The operator list, keyed by the scope it asked for: `null` is the
   * platform-wide feed, and it is a different list from any workspace's, so
   * switching audience must not read the previous scope's rows from the cache.
   */
  announcementsAdmin: (workspaceId: number | null) => ["announcements", "admin", workspaceId] as const,
};
