import type { useTranslations } from "next-intl";

import { ApiError, getApiErrorMessage } from "@/lib/api/error";

export type DiscordSettingsTranslator = ReturnType<
  typeof useTranslations<"adminWorkspace.workspaceSettings.discord">
>;

/**
 * The three ways a bind can fail, in the organiser's words.
 *
 * They are genuinely different situations (one is about this account, one is
 * about another workspace, one is about Discord being down) and a single
 * "could not link" toast would send the reader looking in the wrong place for
 * all three. The backend answers 403/409/503 exactly (`verify_discord_guild`),
 * so the status IS the distinction.
 */
const BIND_FAILURE_KEYS: Record<number, "bindForbidden" | "bindClaimed" | "bindUnreachable"> = {
  403: "bindForbidden",
  409: "bindClaimed",
  503: "bindUnreachable"
};

export function bindFailure(error: unknown, t: DiscordSettingsTranslator): string {
  const status = error instanceof ApiError ? error.status : 0;
  const key = BIND_FAILURE_KEYS[status];
  return key ? t(key) : getApiErrorMessage(error, t("linkError"));
}

/**
 * The three ways an announcement save can fail, in the organiser's words: a
 * guild that was unlinked since the page loaded, Discord being unreachable,
 * and whatever the server said about the channel are three different fixes.
 */
export function announcementFailure(error: unknown, t: DiscordSettingsTranslator): string {
  const status = error instanceof ApiError ? error.status : 0;
  if (status === 409) return t("announcementUnlinked");
  if (status === 503) return t("announcementUnreachable");
  return getApiErrorMessage(error, t("saveAnnouncementError"));
}
