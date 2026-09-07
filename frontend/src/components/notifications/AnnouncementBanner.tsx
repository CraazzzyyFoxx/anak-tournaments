"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useAuthProfile } from "@/hooks/useAuthProfile";
import { readDismissedAnnouncements, rememberDismissedAnnouncement } from "@/lib/announcement-dismissed";
import { announcementText } from "@/lib/announcement-text";
import { notificationQueryKeys } from "@/lib/notification-query-keys";
import notificationService from "@/services/notification.service";
import type { NotificationItem } from "@/types/notification.types";

interface AnnouncementBannerProps {
  /** The layout's server-side read, so the banner is in the first paint instead
   *  of dropping in after hydration and shoving the page down. */
  initial?: NotificationItem[];
}

interface AnnouncementContent {
  title: string;
  body: string | null;
  href: string | null;
}

/**
 * The banner's own reading of a row: the viewer's text (locale choice lives in
 * `announcementText`) plus the link, which is re-checked here even though
 * `AnnouncementPayload._href_is_safe` already rejects anything else on the way
 * in — this value ends up as an anchor target on a page every visitor sees, and
 * a `javascript:` URL there is stored XSS. Two cheap checks on a link nobody
 * can edit twice.
 */
function announcementContent(payload: Record<string, unknown>, locale: string): AnnouncementContent | null {
  const text = announcementText(payload, locale);
  if (!text?.title) return null;

  const raw = typeof payload.href === "string" ? payload.href : null;
  const href = raw && (raw.startsWith("https://") || (raw.startsWith("/") && !raw.startsWith("//"))) ? raw : null;

  return { title: text.title, body: text.body ?? null, href };
}

/**
 * The platform-wide announcement strip under the header, on every page and for
 * every visitor — it is the only notification surface an anonymous one has.
 *
 * In the document flow on purpose: `position: fixed` would either cover the
 * first rows of content or force every page to reserve a gap for a banner that
 * usually is not there. It is a region, not a dialog: nothing is focused on
 * mount and nothing is trapped, because an operator notice must not interrupt
 * whatever the visitor came to do.
 */
const AnnouncementBanner = ({ initial }: AnnouncementBannerProps) => {
  const t = useTranslations<never>();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const { user } = useAuthProfile();
  const authUserId = user?.id ?? null;

  // Read once per mount: the list only grows through this component, so
  // re-reading storage on every render would buy nothing.
  const [dismissed, setDismissed] = useState<number[]>(() => readDismissedAnnouncements());

  const query = useQuery({
    queryKey: notificationQueryKeys.activeAnnouncements(),
    queryFn: () => notificationService.activeAnnouncements(),
    initialData: initial,
    // Nobody asked for this read: it runs on every page for every visitor,
    // including anonymous ones. A failure means no banner, not an error toast
    // over whatever the visitor actually came to do.
    meta: { suppressErrorToast: true }
  });

  const markRead = useMutation({
    mutationFn: (ids: number[]) => notificationService.markRead(ids),
    onSuccess: () => {
      // A read mark *is* the dismissal, and the bell counts the same rows — so
      // closing the banner has to drop its badge too.
      void queryClient.invalidateQueries({ queryKey: notificationQueryKeys.list() });
      void queryClient.invalidateQueries({ queryKey: notificationQueryKeys.activeAnnouncements() });
    }
  });

  // Newest wins, and the order is established here rather than trusted from the
  // response: showing two notices would double the header's height, and showing
  // the older one is worse than showing none.
  const announcement = (query.data ?? [])
    .filter((item) => !item.is_read && !dismissed.includes(item.id))
    .reduce<NotificationItem | null>(
      (newest, item) => (newest && newest.published_at >= item.published_at ? newest : item),
      null
    );

  const content = announcement ? announcementContent(announcement.payload, locale) : null;
  if (!announcement || !content) {
    return null;
  }

  const onDismiss = () => {
    // Hide it locally either way: the mutation's refetch takes a round trip,
    // and a banner that lingers after its close button reads as broken.
    setDismissed((ids) => [...ids, announcement.id]);
    if (authUserId != null) {
      markRead.mutate([announcement.id]);
    } else {
      rememberDismissedAnnouncement(announcement.id);
    }
  };

  return (
    <section
      role="region"
      aria-label={t("notifications.banner.label")}
      className="mt-4 flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">{content.title}</p>
        {content.body && <p className="mt-1 text-sm text-muted-foreground">{content.body}</p>}
        {content.href && (
          <Link
            href={content.href}
            className="mt-1 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {t("notifications.banner.more")}
          </Link>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="-mr-1 -mt-1 shrink-0"
        aria-label={t("notifications.banner.dismiss")}
        onClick={onDismiss}
      >
        <X className="h-4 w-4" aria-hidden />
      </Button>
    </section>
  );
};

export default AnnouncementBanner;
