import type { Formatter } from "@/lib/datetime";
import type { AuditLogRead } from "@/types/admin.types";
import type { DashboardIssue } from "@/types/admin-dashboard.types";

/** Rows the activity feed shows, after merging. */
const ACTIVITY_GROUP_LIMIT = 15;

/** One feed row: consecutive audit rows by the same actor doing the same thing. */
export interface ActivityGroup {
  /** The newest row of the run: it names the actor, the action and the time. */
  head: AuditLogRead;
  count: number;
  /** Every row of the run is about one entity, so the group can link to it. */
  sameEntity: boolean;
}

/** A machine row has no actor id; its source (Discord, Challonge) is who acted. */
function actorKey(row: AuditLogRead): string {
  return row.actor_auth_user_id == null ? `source:${row.source}` : `user:${row.actor_auth_user_id}`;
}

/**
 * Merges consecutive rows (newest first, as the feed reads them) with the same
 * actor, action and entity type, so "admin2 approved 6 registrations" is one row
 * instead of six. A repeat after someone else acted starts a new group.
 */
export function groupAuditActivity(
  rows: readonly AuditLogRead[],
  limit: number = ACTIVITY_GROUP_LIMIT
): ActivityGroup[] {
  const groups: ActivityGroup[] = [];
  let last: ActivityGroup | undefined;
  for (const row of rows) {
    if (
      last &&
      actorKey(last.head) === actorKey(row) &&
      last.head.action === row.action &&
      last.head.entity_type === row.entity_type
    ) {
      last.count += 1;
      last.sameEntity &&= last.head.entity_id === row.entity_id;
      continue;
    }
    if (groups.length === limit) break;
    last = { head: row, count: 1, sameEntity: true };
    groups.push(last);
  }
  return groups;
}

/** Entities with an admin page of their own, by `entity_type`. */
const ENTITY_ROUTES: Record<string, string> = {
  tournament: "/admin/tournaments",
  team: "/admin/teams",
  user: "/admin/people"
};

export function auditEntityHref(row: Pick<AuditLogRead, "entity_type" | "entity_id">): string | null {
  // `hasOwn`, not a bare lookup: `toString` is on every object's prototype and is no entity.
  if (row.entity_type == null || row.entity_id == null || !Object.hasOwn(ENTITY_ROUTES, row.entity_type)) return null;
  return `${ENTITY_ROUTES[row.entity_type]}/${row.entity_id}`;
}

/**
 * Where each work-queue issue is fixed: the hub screen the living checklist
 * (`tournament-checklist.ts`) sends the same condition to. A relative route is
 * under the tournament's hub. A `Record`, so a new issue key fails the build here.
 */
const ISSUE_ROUTES: Record<DashboardIssue["key"], string> = {
  results_disputed: "matches/reports?result_status=disputed",
  results_pending_confirmation: "matches/reports?result_status=pending_confirmation",
  results_overdue: "matches/encounters",
  // The status control sits in the hub header, above every tab.
  phase_overdue: "overview",
  registrations_pending: "registration/entries",
  ranks_missing: "registration/entries",
  pool_need_fix: "teams/roster",
  balance_not_exported: "teams/roster",
  stage_slots_empty: "bracket",
  standings_recalc_pending: "bracket",
  logs_missing: "matches/logs",
  achievements_pending: "/admin/achievements"
};

export function issueHref(issue: Pick<DashboardIssue, "key" | "tournament_id">): string {
  const route = ISSUE_ROUTES[issue.key];
  return route.startsWith("/") ? route : `/admin/tournaments/${issue.tournament_id}/${route}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

type DayFormatter = Pick<Formatter, "dateTime">;

/** A calendar day in the formatter's zone (the viewer's), comparable as a string. */
function dayKey(format: DayFormatter, date: Date): string {
  return format.dateTime(date, { year: "numeric", month: "2-digit", day: "2-digit" });
}

export interface DayGroup<T> {
  key: string;
  /** The first item's moment; every moment of the day names the same day. */
  date: Date;
  items: T[];
}

/** Runs of consecutive items on one calendar day of the viewer's zone, in the order given. */
export function groupByDay<T>(items: readonly T[], at: (item: T) => string, format: DayFormatter): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  for (const item of items) {
    const date = new Date(at(item));
    const key = dayKey(format, date);
    const last = groups.at(-1);
    if (last?.key === key) last.items.push(item);
    else groups.push({ key, date, items: [item] });
  }
  return groups;
}

/** "Today", "Tomorrow" or "Yesterday" around `now`, else the weekday and date; all in the viewer's zone. */
export function dayLabel(
  format: DayFormatter,
  date: Date,
  now: Date,
  words: Readonly<{ today: string; tomorrow: string; yesterday: string }>
): string {
  const key = dayKey(format, date);
  if (key === dayKey(format, now)) return words.today;
  if (key === dayKey(format, new Date(now.getTime() + DAY_MS))) return words.tomorrow;
  if (key === dayKey(format, new Date(now.getTime() - DAY_MS))) return words.yesterday;
  return format.dateTime(date, { weekday: "short", day: "numeric", month: "short" });
}
