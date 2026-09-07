"use client";

import { useFormatter, useLocale, useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { announcementText } from "@/lib/announcement-text";
import { cn } from "@/lib/utils";
import type { NotificationItem } from "@/types/notification.types";

/** The kinds v1 ships messages for. The union exists so the dynamic key below
 *  is a cast to something real rather than to `any`; the backend is free to add
 *  a sixth kind, which then falls through to the raw-kind branch. */
type KindMessageKey =
  `notifications.kinds.${
    | "team_invite.received"
    | "team_invite.answered"
    | "registration.approved"
    | "registration.rejected"
    | "encounter.report_disputed"
    | "announcement.published"}`;

interface NotificationListProps {
  items: NotificationItem[];
  unreadCount: number;
  isLoading: boolean;
  isMarkingRead: boolean;
  onMarkAllRead: () => void;
}

/**
 * ICU values for a kind's message. Only strings and numbers cross over: a
 * payload also carries nested objects (an announcement's per-locale text),
 * which no message interpolates and which `t()` would refuse as values.
 */
function messageValues(payload: Record<string, unknown>): Record<string, string | number> {
  const values: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === "string" || typeof value === "number") {
      values[key] = value;
    }
  }
  return values;
}

const NotificationList = ({
  items,
  unreadCount,
  isLoading,
  isMarkingRead,
  onMarkAllRead
}: NotificationListProps) => {
  const t = useTranslations<never>();
  const locale = useLocale();
  const format = useFormatter();

  /**
   * The one line a row renders. Never text from the API for a system kind: the
   * row carries `kind` + a payload snapshot, so wording is fixed by editing the
   * dictionary rather than by rewriting rows written months ago.
   *
   * An unknown kind renders as its own kind string instead of the raw
   * `notifications.kinds.*` path next-intl would echo: the backend may start
   * sending a fifth kind before this client ships, and a key path in the inbox
   * reads as a bug while the kind at least says what happened.
   */
  const notificationText = (item: NotificationItem): string => {
    if (item.kind === "announcement.published") {
      const title = announcementText(item.payload, locale)?.title;
      if (title) return title;
    }
    // `kind` is a wire string, so it is NOT a member of the dictionary's
    // compile-time key union — deliberately: a fifth kind must not need a
    // client release. `t.has` is the runtime check that makes the cast safe,
    // the same discipline `formatRequirementName` uses on an untyped code.
    const key = `notifications.kinds.${item.kind}` as KindMessageKey;
    if (typeof t.has === "function" && !t.has(key)) return item.kind;
    return t(key, messageValues(item.payload));
  };

  return (
    <div className="flex max-h-[70vh] flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <p className="text-sm font-semibold">{t("notifications.title")}</p>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={onMarkAllRead}
          disabled={unreadCount === 0 || isMarkingRead}
        >
          {t("notifications.markAllRead")}
        </Button>
      </div>

      {isLoading ? (
        <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : items.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-muted-foreground">
          {t("notifications.empty")}
        </p>
      ) : (
        <ul className="divide-y overflow-y-auto">
          {items.map((item) => (
            <li
              key={item.id}
              className={cn("flex flex-col gap-1 px-3 py-2 text-sm", !item.is_read && "bg-muted/40")}
            >
              <span>
                {/* Unread is carried by a word, not only by the tint: a
                    background shade says nothing to a screen reader and little
                    to a viewer who cannot separate the two greys. */}
                {!item.is_read && <span className="sr-only">{t("notifications.unread")} </span>}
                {notificationText(item)}
              </span>
              <time dateTime={item.published_at} className="text-xs text-muted-foreground">
                {format.relativeTime(new Date(item.published_at))}
              </time>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default NotificationList;
