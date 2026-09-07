"use client";

import Link from "next/link";
import { useFormatter, useLocale, useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { PopoverClose } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { announcementText } from "@/lib/announcement-text";
import { notificationHref } from "@/lib/notification-href";
import { cn } from "@/lib/utils";
import type { NotificationItem } from "@/types/notification.types";

type KindMessageKey = `notifications.kinds.${
  | "team_invite.received"
  | "team_invite.answered"
  | "registration.approved"
  | "registration.rejected"
  | "encounter.report_disputed"
  | "announcement.published"}`;

interface NotificationListProps {
  headingId: string;
  items: NotificationItem[];
  unreadCount: number | null;
  isLoading: boolean;
  hasData: boolean;
  isError: boolean;
  isFetching: boolean;
  retry: () => void;
  isMarkingRead: boolean;
  markingId: number | null;
  markReadStatus: "idle" | "pending" | "error" | "success";
  markAllRead: () => void;
  markOneRead: (id: number) => void;
  retryMarkRead: () => void;
  hasMore: boolean;
  isLoadingMore: boolean;
  isLoadMoreError: boolean;
  loadMore: () => void;
}

/** Only scalar payload values are valid ICU interpolation arguments. */
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
  headingId,
  items,
  unreadCount,
  isLoading,
  hasData,
  isError,
  isFetching,
  retry,
  isMarkingRead,
  markingId,
  markReadStatus,
  markAllRead,
  markOneRead,
  retryMarkRead,
  hasMore,
  isLoadingMore,
  isLoadMoreError,
  loadMore
}: NotificationListProps) => {
  const t = useTranslations<never>();
  const locale = useLocale();
  const format = useFormatter();

  const notificationText = (item: NotificationItem): string => {
    if (item.kind === "announcement.published") {
      const title = announcementText(item.payload, locale)?.title;
      if (title) return title;
    }
    const key = `notifications.kinds.${item.kind}` as KindMessageKey;
    if (!t.has(key)) return t("notifications.unknownKind");
    return t(key, messageValues(item.payload));
  };
  const markAllUnavailable = unreadCount == null || unreadCount === 0 || isMarkingRead;
  const readStatus = isMarkingRead
    ? t(markingId == null ? "notifications.markingAllRead" : "notifications.markingRead")
    : markReadStatus === "error"
      ? t("notifications.markReadError")
      : markReadStatus === "success"
        ? t(markingId == null ? "notifications.markedAllRead" : "notifications.markedRead")
        : "";

  return (
    <div className="flex min-h-0 max-h-[min(70dvh,var(--radix-popover-content-available-height))] flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <h2 id={headingId} className="text-sm font-semibold">
          {t("notifications.title")}
        </h2>
        <Button
          static={false}
          variant="ghost"
          size="sm"
          className="h-auto min-h-10 whitespace-normal px-2 text-xs aria-disabled:pointer-events-none aria-disabled:opacity-50 sm:min-h-8"
          onClick={() => {
            if (!markAllUnavailable) markAllRead();
          }}
          aria-disabled={markAllUnavailable}
          aria-busy={isMarkingRead && markingId == null}
        >
          {t(
            isMarkingRead && markingId == null
              ? "notifications.markingAllRead"
              : "notifications.markAllRead"
          )}
        </Button>
      </div>

      <div
        tabIndex={0}
        aria-label={t("notifications.title")}
        className="min-h-0 overflow-y-auto overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {isError && (
          <div className="space-y-2 px-3 py-4">
            <p role="status" className="text-sm">
              {t(hasData ? "notifications.refreshError" : "notifications.loadError")}
            </p>
            <Button
              static={false}
              variant="outline"
              size="sm"
              onClick={retry}
              disabled={isFetching}
            >
              {t(isFetching ? "common.loading" : "notifications.retry")}
            </Button>
          </div>
        )}
        {isLoading ? (
          <div
            aria-busy="true"
            aria-label={t("notifications.loading")}
            className="space-y-5 px-3 py-4"
          >
            <span role="status" className="sr-only">
              {t("notifications.loading")}
            </span>
            {[0, 1, 2].map((row) => (
              <div key={row} aria-hidden="true" className="space-y-2">
                <Skeleton className="h-4 w-full motion-reduce:animate-none" />
                <Skeleton className="h-4 w-3/4 motion-reduce:animate-none" />
                <Skeleton className="h-3 w-1/3 motion-reduce:animate-none" />
              </div>
            ))}
          </div>
        ) : hasData && items.length === 0 && !isError ? (
          <div className="px-3 py-6 text-center">
            <p className="text-sm font-medium">{t("notifications.empty")}</p>
            <p className="mt-1 text-pretty text-sm text-muted-foreground">
              {t("notifications.emptyHint")}
            </p>
          </div>
        ) : items.length > 0 ? (
          <ul className="divide-y">
            {items.map((item) => {
              const href = notificationHref(item);
              const text = notificationText(item);
              const isPending = isMarkingRead && (markingId == null || markingId === item.id);
              const unavailable = item.is_read || isMarkingRead;
              return (
                <li
                  key={item.id}
                  className={cn(
                    "flex flex-col gap-2 px-3 py-3 text-sm",
                    !item.is_read && "bg-muted/40"
                  )}
                >
                  <span className="flex items-start gap-2">
                    <span
                      aria-hidden="true"
                      className={cn(
                        "mt-1.5 size-1.5 shrink-0 rounded-full",
                        !item.is_read && "bg-primary"
                      )}
                    />
                    {!item.is_read && <span className="sr-only">{t("notifications.unread")} </span>}
                    {href ? (
                      <PopoverClose asChild>
                        <Link
                          href={href}
                          className="min-w-0 flex-1 [overflow-wrap:anywhere] underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                        >
                          {text}
                        </Link>
                      </PopoverClose>
                    ) : (
                      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{text}</span>
                    )}
                  </span>
                  <div className="flex flex-wrap items-center justify-between gap-2 ps-3.5">
                    <time dateTime={item.published_at} className="text-xs text-muted-foreground">
                      {format.relativeTime(new Date(item.published_at))}
                    </time>
                    <Button
                      static={false}
                      variant="ghost"
                      size="sm"
                      className="h-auto min-h-10 whitespace-normal px-2 text-xs aria-disabled:pointer-events-none aria-disabled:opacity-50 sm:min-h-8"
                      aria-label={t(
                        item.is_read ? "notifications.readFor" : "notifications.markReadFor",
                        { notification: text }
                      )}
                      aria-disabled={unavailable}
                      aria-busy={isPending}
                      onClick={() => {
                        if (!unavailable) markOneRead(item.id);
                      }}
                    >
                      {t(
                        isPending
                          ? "notifications.markingRead"
                          : item.is_read
                            ? "notifications.read"
                            : "notifications.markRead"
                      )}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>

      <div className="shrink-0">
        <p
          role="status"
          aria-atomic="true"
          className={cn("text-sm", readStatus ? "border-t px-3 py-2" : "sr-only")}
        >
          {readStatus}
        </p>
        {markReadStatus === "error" && (
          <div className="px-3 pb-2">
            <Button static={false} variant="outline" size="sm" onClick={retryMarkRead}>
              {t("notifications.retryMarkRead")}
            </Button>
          </div>
        )}
        {hasMore && (
          <div className="border-t p-2">
            <p role="status" className={cn("text-sm", isLoadMoreError ? "px-1 pb-2" : "sr-only")}>
              {isLoadMoreError
                ? t("notifications.loadMoreError")
                : isLoadingMore
                  ? t("notifications.loadingMore")
                  : ""}
            </p>
            <Button
              static={false}
              variant="ghost"
              size="sm"
              className="h-auto min-h-10 w-full whitespace-normal text-xs sm:min-h-8"
              onClick={loadMore}
              disabled={isFetching || isMarkingRead}
            >
              {t(
                isLoadingMore
                  ? "notifications.loadingMore"
                  : isLoadMoreError
                    ? "notifications.retryLoadMore"
                    : "notifications.loadMore"
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default NotificationList;
