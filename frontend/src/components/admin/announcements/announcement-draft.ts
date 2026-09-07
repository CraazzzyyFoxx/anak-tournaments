/**
 * The announcement form's rules, as data.
 *
 * The locale rules live on the server (`shared.services.notifications.
 * AnnouncementPayload`), and they stay there — this file does not re-decide
 * them, it only stops the operator from spending a round trip to learn one. So
 * there is exactly ONE function that reads a draft: it either returns the
 * request body or the reason there isn't one, and the form derives everything
 * it shows — which fallback locales are offered, whether Publish is refused —
 * from the same `filledLocales` it uses. Spelling "a title makes a locale
 * count" a second time in the JSX is how the two halves drift.
 */

import type { AnnouncementCreateBody, AnnouncementLocaleText } from "@/types/notification.types";

/** Mirrors `SUPPORTED_LOCALES` — the tab order is the display order. */
export const ANNOUNCEMENT_LOCALES = ["ru", "en"] as const;
export type AnnouncementLocale = (typeof ANNOUNCEMENT_LOCALES)[number];

/** `user` is unreachable through this surface, by schema. */
export type AnnouncementAudience = "workspace" | "global";

export interface AnnouncementDraft {
  audience: AnnouncementAudience;
  /** The scope a `workspace` announcement is published into. */
  workspaceId: number | null;
  locales: Record<AnnouncementLocale, { title: string; body: string }>;
  defaultLocale: AnnouncementLocale;
  href: string;
  /** `datetime-local` values — empty means "now" and "never" respectively. */
  publishedAt: string;
  expiresAt: string;
}

export type AnnouncementDraftError =
  | "noLocale"
  | "missingLocales"
  | "defaultLocaleEmpty"
  | "noWorkspace"
  | "badDate";

export type AnnouncementDraftResult =
  | { ok: true; body: AnnouncementCreateBody }
  | { ok: false; error: AnnouncementDraftError };

export function emptyAnnouncementDraft(
  audience: AnnouncementAudience,
  workspaceId: number | null,
): AnnouncementDraft {
  return {
    audience,
    workspaceId,
    locales: { ru: { title: "", body: "" }, en: { title: "", body: "" } },
    defaultLocale: ANNOUNCEMENT_LOCALES[0],
    href: "",
    publishedAt: "",
    expiresAt: "",
  };
}

/**
 * A locale counts as written when it has a title. The body is optional in the
 * payload schema, so text in the body alone is a locale with nothing to show.
 */
export function filledLocales(draft: AnnouncementDraft): AnnouncementLocale[] {
  return ANNOUNCEMENT_LOCALES.filter((locale) => draft.locales[locale].title.trim() !== "");
}

/** `datetime-local` is local wall time; the API takes an instant. */
function instant(value: string): string | null | undefined {
  if (value.trim() === "") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

export function validateAnnouncementDraft(draft: AnnouncementDraft): AnnouncementDraftResult {
  const filled = filledLocales(draft);
  if (filled.length === 0) return { ok: false, error: "noLocale" };
  // Every supported locale, for a platform-wide one: it is the banner every
  // visitor of the site sees, including the ones who never picked a language.
  if (draft.audience === "global" && filled.length < ANNOUNCEMENT_LOCALES.length) {
    return { ok: false, error: "missingLocales" };
  }
  if (!filled.includes(draft.defaultLocale)) return { ok: false, error: "defaultLocaleEmpty" };
  if (draft.audience === "workspace" && draft.workspaceId == null) {
    return { ok: false, error: "noWorkspace" };
  }

  const publishedAt = instant(draft.publishedAt);
  const expiresAt = instant(draft.expiresAt);
  if (publishedAt === undefined || expiresAt === undefined) {
    return { ok: false, error: "badDate" };
  }

  const locales: Record<string, AnnouncementLocaleText> = {};
  for (const locale of filled) {
    const body = draft.locales[locale].body.trim();
    locales[locale] = { title: draft.locales[locale].title.trim(), ...(body ? { body } : {}) };
  }

  return {
    ok: true,
    body: {
      audience: draft.audience,
      workspace_id: draft.audience === "workspace" ? draft.workspaceId : null,
      locales,
      default_locale: draft.defaultLocale,
      href: draft.href.trim() || null,
      published_at: publishedAt,
      expires_at: expiresAt,
    },
  };
}

export type AnnouncementState = "scheduled" | "active" | "retired";

/**
 * Derived from the two stamps the row already carries, because that is what the
 * reads themselves filter on — a third column saying "active" could disagree
 * with the window that actually decides who sees it.
 *
 * Expiry is checked first: unpublishing sets `expires_at` to now, and a row
 * that was retired before it was ever due is retired, not scheduled.
 */
export function announcementState(
  row: { published_at: string; expires_at: string | null },
  now: number = Date.now(),
): AnnouncementState {
  if (row.expires_at != null && Date.parse(row.expires_at) <= now) return "retired";
  if (Date.parse(row.published_at) > now) return "scheduled";
  return "active";
}

/**
 * The title as this operator reads it, falling back to the one the publisher
 * wrote in: a workspace announcement is only required to carry one locale, so
 * the viewer's may genuinely be missing.
 */
export function announcementTitle(payload: Record<string, unknown>, locale: string): string | null {
  const locales = payload.locales as Record<string, AnnouncementLocaleText> | undefined;
  if (!locales) return null;
  const fallback = typeof payload.default_locale === "string" ? payload.default_locale : null;
  return (locales[locale] ?? (fallback ? locales[fallback] : undefined))?.title ?? null;
}
