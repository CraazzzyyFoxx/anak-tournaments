"use client";

import { Bell } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import NotificationList from "@/components/notifications/NotificationList";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuthProfile } from "@/hooks/useAuthProfile";
import { useNotifications } from "@/hooks/useNotifications";

/** The authenticated inbox; Radix owns dismissal and focus restoration. */
const NotificationBell = () => {
  const t = useTranslations<never>();
  const { user } = useAuthProfile();
  const authUserId = user?.id ?? null;
  const [open, setOpen] = useState(false);
  const headingId = useId();
  const notifications = useNotifications(authUserId);
  const { unreadCount } = notifications;

  if (authUserId == null) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          static={false}
          variant="ghost"
          size="icon"
          className="relative data-[state=open]:bg-accent data-[state=open]:text-accent-foreground [&_svg]:size-5"
          aria-label={
            unreadCount == null
              ? t("notifications.title")
              : t("notifications.bell", { count: unreadCount })
          }
        >
          <Bell aria-hidden />
          {unreadCount != null && unreadCount > 0 && (
            <span
              aria-hidden
              className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-destructive px-1 text-[11px] font-semibold tabular-nums leading-4 text-destructive-foreground"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={12}
        aria-labelledby={headingId}
        animate={false}
        className="w-80 max-w-[calc(100vw-1.5rem)] p-0 motion-safe:data-[state=open]:animate-in motion-safe:data-[state=closed]:animate-out motion-safe:data-[state=open]:fade-in-0 motion-safe:data-[state=closed]:fade-out-0 motion-safe:duration-150 motion-safe:ease-out"
      >
        <NotificationList headingId={headingId} {...notifications} />
      </PopoverContent>
    </Popover>
  );
};

export default NotificationBell;
