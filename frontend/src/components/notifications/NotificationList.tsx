"use client";

import Link from "next/link";
import { useFormatter, useLocale, useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { PopoverClose } from "@/components/ui/popover";
import { announcementHref, announcementText } from "@/lib/announcement-text";
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
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
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
  onMarkAllRead,
  hasMore,
  isLoadingMore,
  onLoadMore
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
        // Not a bare "no results": the inbox is empty for most of its life, so
        // the state has to say what will land here rather than just that
        // nothing has.
        <div className="px-3 py-6 text-center">
          <p className="text-sm font-medium">{t("notifications.empty")}</p>
          <p className="mt-1 text-pretty text-sm text-muted-foreground">{t("notifications.emptyHint")}</p>
        </div>
      ) : (
        // `tabIndex={0}` because this is the scroll container: rows below the
        // fold are otherwise unreachable without a pointer whenever the visible
        // ones hold no link (WCAG 2.1.1).
        <ul
          tabIndex={0}
          aria-label={t("notifications.title")}
          className="divide-y overflow-y-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          {items.map((item) => {
            const href = item.kind === "announcement.published" ? announcementHref(item.payload) : null;
            const text = notificationText(item);

            return (
              <li
                key={item.id}
                className={cn("flex flex-col gap-1 px-3 py-2 text-sm", !item.is_read && "bg-muted/40")}
              >
                <span className="flex items-start gap-2">
                  {/* Unread is carried by a dot and a word, never by the tint
                      alone: `bg-muted/40` on `bg-popover` measures 1.15:1, which
                      is nothing to a viewer who cannot separate two near-blacks
                      and nothing at all to a screen reader. The read rows keep
                      the same spacer so every row's text starts on one edge. */}
                  <span
                    aria-hidden
                    className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", !item.is_read && "bg-primary")}
                  />
                  {!item.is_read && <span className="sr-only">{t("notifications.unread")} </span>}
                  {href ? (
                    // The panel is a popover, so a row that navigates has to
                    // close it — otherwise it stays open over the page it just
                    // opened. `PopoverClose` also hands focus back to the bell.
                    <PopoverClose asChild>
                      <Link
                        href={href}
                        className="min-w-0 flex-1 underline-offset-4 hover:underline focus-visible:underline"
                      >
                        {text}
                      </Link>
                    </PopoverClose>
                  ) : (
                    <span className="min-w-0 flex-1">{text}</span>
                  )}
                </span>
                <time dateTime={item.published_at} className="ps-3.5 text-xs text-muted-foreground">
                  {format.relativeTime(new Date(item.published_at))}
                </time>
              </li>
            );
          })}
        </ul>
      )}

      {/* The server answers 20 rows and a cursor; without this the 21st
          notification exists on no surface at all. */}
      {hasMore && (
        <div className="border-t p-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs"
            onClick={onLoadMore}
            disabled={isLoadingMore}
          >
            {isLoadingMore ? t("common.loading") : t("notifications.loadMore")}
          </Button>
        </div>
      )}
    </div>
  );
};

export default NotificationList;
