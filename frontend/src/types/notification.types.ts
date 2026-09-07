/**
 * The inbox wire types (`GET /api/notifications`, `GET /api/announcements/active`).
 *
 * A row carries `kind` + a payload *snapshot*, never rendered text: the client
 * renders `t("notifications.kinds." + kind, payload)`, so a wording fix reaches
 * rows written months ago and a deleted team still reads by name. Announcements
 * are the one exception — their operator-written text lives inside the payload,
 * one entry per locale.
 */

export type NotificationAudience = "user" | "workspace" | "global";

/** Operator-written announcement text, per locale, inside `payload.locales`. */
export interface AnnouncementLocaleText {
  title: string;
  body?: string | null;
}

export interface NotificationItem {
  id: number;
  audience: NotificationAudience;
  kind: string;
  /** Snapshot fields the kind's message interpolates. Shape varies by kind. */
  payload: Record<string, unknown>;
  workspace_id: number | null;
  published_at: string;
  expires_at: string | null;
  /** Whether *this* viewer has a read mark on the row. "Read" means "dismissed". */
  is_read: boolean;
}

export interface NotificationInbox {
  items: NotificationItem[];
  unread_count: number;
  /** `null` on the last page. Opaque: parsing it means depending on the sort key. */
  next_cursor: string | null;
}

export interface NotificationMarkReadResult {
  marked: number;
  unread_count: number;
}
