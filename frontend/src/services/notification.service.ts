import { apiFetch } from "@/lib/api-fetch";
import type {
  AnnouncementCreateBody,
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

  /**
   * One scope's announcements for the operator screen, expired ones included.
   *
   * `skipWorkspace` on all three writes and on this read: the scope is the
   * argument, not the ambient workspace. Without it the platform-wide feed
   * (`workspaceId: null`) would silently arrive scoped to whatever workspace
   * the switcher happens to hold, and a superuser would see an empty list
   * instead of the global announcements.
   */
  static async listAnnouncements(params: { workspaceId: number | null }): Promise<NotificationItem[]> {
    return apiFetch("/api/v1/admin/announcements", {
      query: params.workspaceId == null ? {} : { workspace_id: params.workspaceId },
      skipWorkspace: true
    }).then((response) => response.json());
  }

  /** Publish (or schedule) one. 422 when the locales do not cover the audience. */
  static async createAnnouncement(body: AnnouncementCreateBody): Promise<NotificationItem> {
    return apiFetch("/api/v1/admin/announcements", {
      method: "POST",
      body,
      skipWorkspace: true
    }).then((response) => response.json());
  }

  /**
   * Take it off the air. The row stays and so do its read marks — the server
   * sets `expires_at` to now rather than deleting, so "who saw this" survives.
   */
  static async retireAnnouncement(id: number): Promise<void> {
    await apiFetch(`/api/v1/admin/announcements/${id}`, {
      method: "DELETE",
      skipWorkspace: true
    });
  }
}
