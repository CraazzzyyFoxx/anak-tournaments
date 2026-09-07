"use client";

import { Bell } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import NotificationList from "@/components/notifications/NotificationList";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuthProfile } from "@/hooks/useAuthProfile";
import { useNotifications } from "@/hooks/useNotifications";

/**
 * The inbox in the header. The only surface an in-app notification exists on —
 * an invite, a registration decision or a disputed report is unreachable
 * anywhere else in the product.
 *
 * Renders nothing without an identity: the audience is computed from the token,
 * so there is no anonymous inbox to show, and `user:<id>:notifications` is a
 * topic the gateway ACL grants to that user alone.
 */
const NotificationBell = () => {
  const t = useTranslations<never>();
  const { user } = useAuthProfile();
  const authUserId = user?.id ?? null;
  const [open, setOpen] = useState(false);
  const { items, unreadCount, isLoading, isMarkingRead, markAllRead, hasMore, loadMore, isLoadingMore } =
    useNotifications(authUserId);

  if (authUserId == null) {
    return null;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          // The count lives in the accessible name, not only in the badge: a
          // number a screen reader never reaches is the same as no number.
          aria-label={t("notifications.bell", { count: unreadCount })}
        >
          <Bell className="h-5 w-5" aria-hidden />
          {unreadCount > 0 && (
            <span
              aria-hidden
              className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-destructive-foreground"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      {/* Radix owns the keyboard contract here: Escape closes the panel and
          focus returns to the bell, which a hand-rolled dropdown would have to
          re-implement to stay usable without a mouse. */}
      <PopoverContent align="end" className="w-80 p-0">
        <NotificationList
          items={items}
          unreadCount={unreadCount}
          isLoading={isLoading}
          isMarkingRead={isMarkingRead}
          onMarkAllRead={markAllRead}
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          onLoadMore={loadMore}
        />
      </PopoverContent>
    </Popover>
  );
};

export default NotificationBell;
