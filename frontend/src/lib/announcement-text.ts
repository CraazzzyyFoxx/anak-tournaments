/**
 * Which locale of an announcement a viewer reads.
 *
 * An announcement is the one notification row with author-written text, stored
 * one entry per locale. The viewer's locale may genuinely be absent — a
 * workspace announcement is only required to carry one — so the publisher's
 * `default_locale` is the fallback. Three surfaces render the same row (the
 * banner, the inbox and the admin table); a fallback that differed between them
 * would show the same reader two different announcements.
 */

import type { AnnouncementLocaleText } from "@/types/notification.types";

export function announcementText(
  payload: Record<string, unknown>,
  locale: string
): AnnouncementLocaleText | null {
  const locales = payload.locales as Record<string, AnnouncementLocaleText> | undefined;
  if (!locales) return null;
  const fallback = typeof payload.default_locale === "string" ? payload.default_locale : null;
  return locales[locale] ?? (fallback ? locales[fallback] : null) ?? null;
}
