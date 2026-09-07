import { apiFetch } from "@/lib/api-fetch";
import type {
  NotificationInbox,
  NotificationItem,
  NotificationMarkReadResult
} from "@/types/notification.types";

export default class notificationService {
  /**
   * One page of the caller's inbox, newest first, plus the badge count and an
   * opaque continuation. The audience is computed server-side from the token —
   * there is no recipient parameter, and `skipWorkspace` because the page spans
   * every workspace the caller belongs to rather than the current one.
   */
  static async list(params: { limit?: number; cursor?: string | null } = {}): Promise<NotificationInbox> {
    return apiFetch("/api/notifications", {
      query: { limit: params.limit, cursor: params.cursor ?? undefined },
      skipWorkspace: true
    }).then((response) => response.json());
  }

  /**
   * Mark notifications read — which in this feature also means *dismissed*: the
   * announcement banner reads the same marks. `ids` omitted marks the whole
   * visible inbox, and that is the server's own semantic, so "mark all read"
   * must not enumerate the page it happens to be showing.
   */
  static async markRead(ids?: number[]): Promise<NotificationMarkReadResult> {
    return apiFetch("/api/notifications/read", {
      method: "POST",
      body: ids ? { ids } : {},
      skipWorkspace: true
    }).then((response) => response.json());
  }

  /**
   * Platform-wide announcements for the banner. Anonymous callers are welcome
   * (the gateway caches that response for every visitor), so no workspace id
   * may ride along and fragment it.
   */
  static async activeAnnouncements(): Promise<NotificationItem[]> {
    return apiFetch("/api/announcements/active", {
      skipWorkspace: true
    }).then((response) => response.json());
  }
}
