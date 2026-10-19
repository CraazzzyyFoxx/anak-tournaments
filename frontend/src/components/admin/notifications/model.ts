import type { NotificationAdminItem } from "@/types/notification.types";

/** The kinds the operator RPC accepts; the announcement owns another screen. */
export const KINDS = [
  "team_invite.received",
  "team_invite.answered",
  "registration.approved",
  "registration.rejected",
  "registration.opened",
  "check_in.opened",
  "encounter.report_disputed",
  "encounter.dispute_review",
  "encounter.scheduled",
  "team.kicked",
  "team.rejected",
  "team.disbanded"
] as const;

export const ALL_KINDS = "all";
export const KIND_PARAM = "kind";

/**
 * Read off the stamp rather than asked of the backend: the inbox reads filter on
 * exactly this window, so a stored flag could disagree with who actually still
 * sees the row.
 */
export function isRetired(row: NotificationAdminItem): boolean {
  return row.expires_at != null && new Date(row.expires_at).getTime() <= Date.now();
}
