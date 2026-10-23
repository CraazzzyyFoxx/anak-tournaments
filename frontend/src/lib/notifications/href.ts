import { SITE_URL_OBJ } from "@/config/site";
import { announcementHref } from "@/lib/notifications/announcement-text";
import { tournamentHref } from "@/lib/tournament/url";
import type { NotificationItem } from "@/types/notification.types";

function isId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** System destinations come from known routes, never an arbitrary payload href. */
export function notificationHref(item: NotificationItem): string | null {
  const { kind, payload } = item;

  switch (kind) {
    case "announcement.published":
      return announcementHref(payload);
    case "team_invite.received":
    case "registration.approved":
    case "registration.rejected":
    case "team.kicked":
    case "team.rejected":
    case "team.disbanded":
      return isId(payload.tournament_id)
        ? tournamentHref(payload.tournament_id, "/participants")
        : null;
    case "encounter.report_disputed":
    case "encounter.dispute_review":
    case "encounter.scheduled":
      return isId(payload.tournament_id) && isId(payload.encounter_id)
        ? tournamentHref(payload.tournament_id, `/pregame/${payload.encounter_id}`)
        : null;
    // The phase itself is the news, and the tournament page is where both the
    // register and the check-in button live.
    case "registration.opened":
    case "check_in.opened":
      return isId(payload.tournament_id) ? tournamentHref(payload.tournament_id) : null;
    // A mix captain's room: the lobby's own page, whose route takes the letter. On the platform host, like the
    // Discord DM's `PUBLIC_SITE_URL` link: the bell is read on any community's host, and a mix answers 404 on
    // another community's.
    case "mix.ban_room_opened":
    case "mix.draft_started":
      return isId(payload.custom_game_id) &&
        typeof payload.lobby === "string" &&
        /^[A-F]$/.test(payload.lobby)
        ? new URL(`/balancer/mix/${payload.custom_game_id}/lobby/${payload.lobby}`, SITE_URL_OBJ).toString()
        : null;
    // An answered invite has only a pre-formation team ID, not a tournament
    // reference. It cannot link to the unrelated post-balancer team routes.
    case "team_invite.answered":
    default:
      return null;
  }
}
