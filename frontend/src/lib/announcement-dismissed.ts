/**
 * Which announcements this browser has closed — the anonymous half of "read
 * means dismissed".
 *
 * A signed-in viewer gets a `notification_read` row, which is why the banner
 * stays closed on their phone too. A visitor without an account has nothing to
 * hang that row on, so the ids live here instead: per-browser, no request, and
 * no server-side identity invented for someone who has none.
 *
 * ponytail: dismissals stored here are never merged into `notification_read` at
 * login, so a visitor who closes the banner and then signs in sees it once more
 * on that same browser. Upgrade path when that one extra impression matters:
 * post this list to `notifications_mark_read` from the auth bootstrap after a
 * successful sign-in and clear the key — the endpoint already validates each id
 * against the caller's audience, so nothing else has to change.
 */

export const DISMISSED_ANNOUNCEMENTS_STORAGE_KEY = "owt.announcement.dismissed";

// Announcements expire, so an unbounded list would only accumulate ids the
// server stopped sending months ago.
const KEEP_LAST = 50;

export function readDismissedAnnouncements(): number[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(DISMISSED_ANNOUNCEMENTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is number => typeof id === "number");
  } catch {
    // Storage disabled or holding something that is not our JSON: treat it as
    // "nothing dismissed" rather than letting a banner take the page down.
    return [];
  }
}

export function rememberDismissedAnnouncement(id: number): void {
  if (typeof window === "undefined") return;
  try {
    const next = [...readDismissedAnnouncements().filter((known) => known !== id), id].slice(-KEEP_LAST);
    window.localStorage.setItem(DISMISSED_ANNOUNCEMENTS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private mode / blocked storage: the banner comes back next visit. The
    // alternative — surfacing an error over an operator notice — is worse.
  }
}
