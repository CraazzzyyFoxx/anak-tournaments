import type { Tournament, TournamentStatus } from "@/types/tournament.types";

type TournamentStatusMeta = {
  label: string;
  badgeLabel: string;
  /**
   * Which of the four presentation buckets this status falls into. The public
   * tournament surfaces collapse seven statuses into live / upcoming /
   * finished / draft; three files each re-derived that with the same nested
   * ternary. It is a domain fact about the status, so it lives here once.
   */
  variant: "live" | "upcoming" | "finished" | "draft";
  textClassName: string;
  badgeClassName: string;
  dotClassName?: string;
  isActive: boolean;
  isEnded: boolean;
};

const TOURNAMENT_STATUS_META: Record<TournamentStatus, TournamentStatusMeta> = {
  draft: {
    label: "Draft",
    badgeLabel: "Draft",
    variant: "draft",
    textClassName: "text-[color:var(--aqt-gold)]",
    badgeClassName: "text-[color:var(--aqt-gold)]",
    dotClassName: "bg-[color:var(--aqt-gold)]",
    isActive: true,
    isEnded: false
  },
  registration: {
    label: "Registration",
    badgeLabel: "Registration",
    variant: "upcoming",
    textClassName: "text-[color:var(--aqt-tank)]",
    badgeClassName: "text-[color:var(--aqt-tank)]",
    dotClassName: "bg-[color:var(--aqt-tank)]",
    isActive: true,
    isEnded: false
  },
  check_in: {
    label: "Check-in",
    badgeLabel: "Check-in",
    variant: "upcoming",
    textClassName: "text-[color:var(--aqt-amber)]",
    badgeClassName: "text-[color:var(--aqt-amber)]",
    dotClassName: "bg-[color:var(--aqt-amber)]",
    isActive: true,
    isEnded: false
  },
  live: {
    label: "Live",
    badgeLabel: "Live",
    variant: "live",
    textClassName: "text-[color:var(--aqt-emerald)]",
    badgeClassName: "text-[color:var(--aqt-emerald)]",
    dotClassName: "bg-[color:var(--aqt-emerald)]",
    isActive: true,
    isEnded: false
  },
  playoffs: {
    label: "Playoffs",
    badgeLabel: "Playoffs",
    variant: "live",
    textClassName: "text-[color:var(--aqt-violet)]",
    badgeClassName: "text-[color:var(--aqt-violet)]",
    dotClassName: "bg-[color:var(--aqt-violet)]",
    isActive: true,
    isEnded: false
  },
  completed: {
    label: "Ended",
    badgeLabel: "Ended",
    variant: "finished",
    textClassName: "text-[color:var(--aqt-fg-muted)]",
    badgeClassName: "text-[color:var(--aqt-fg-dim)]",
    isActive: false,
    isEnded: true
  },
  archived: {
    label: "Archived",
    badgeLabel: "Archived",
    variant: "finished",
    textClassName: "text-[color:var(--aqt-fg-dim)]",
    badgeClassName: "text-[color:var(--aqt-fg-dim)]",
    isActive: false,
    isEnded: true
  }
};

export function getTournamentStatusMeta(status: TournamentStatus) {
  return TOURNAMENT_STATUS_META[status];
}

export function isTournamentStatusActive(status: TournamentStatus) {
  return TOURNAMENT_STATUS_META[status].isActive;
}

export function isTournamentStatusEnded(status: TournamentStatus) {
  return TOURNAMENT_STATUS_META[status].isEnded;
}

export const TOURNAMENT_STATUS_ORDER: TournamentStatus[] = [
  "live",
  "playoffs",
  "registration",
  "check_in",
  "completed",
  "archived",
  "draft"
];

export function countByTournamentStatus(
  statuses: ReadonlyArray<TournamentStatus>
): Record<TournamentStatus, number> {
  const counts: Record<TournamentStatus, number> = {
    draft: 0,
    registration: 0,
    check_in: 0,
    live: 0,
    playoffs: 0,
    completed: 0,
    archived: 0
  };
  for (const status of statuses) {
    counts[status] += 1;
  }
  return counts;
}

/**
 * True when the tournament currently sits in `status` and `now` falls inside
 * that phase's schedule row window. A missing row or a `null` ends_at means
 * the window spans the whole phase.
 */
export function isPhaseWindowActive(
  tournament: Pick<Tournament, "status" | "phase_schedule">,
  status: TournamentStatus,
  now: number = Date.now()
) {
  if (tournament.status !== status) return false;

  const row = tournament.phase_schedule?.find((entry) => entry.status === status);
  if (!row) return true;

  const startsAt = new Date(row.starts_at).getTime();
  const endsAt = row.ends_at ? new Date(row.ends_at).getTime() : null;
  return startsAt <= now && (endsAt === null || now <= endsAt);
}

/**
 * Mirrors the backend registration gate: the tournament's REGISTRATION phase
 * window is the only switch.
 *
 * A MISSING row means closed — deliberately the opposite of
 * `isPhaseWindowActive` above, whose "no row spans the whole phase" rule stays
 * as-is for check-in. The tournament's own phase does not participate: late
 * registration is an `ends_at` that reaches past the LIVE start, which is what
 * replaced the old `allow_late_registration` flag and the form's `is_open`
 * kill switch.
 */
export function isRegistrationOpen(
  tournament: Pick<Tournament, "status" | "phase_schedule">,
  now: number = Date.now()
) {
  if (tournament.status === "completed" || tournament.status === "archived") return false;

  const row = tournament.phase_schedule?.find((entry) => entry.status === "registration");
  if (!row) return false;

  const startsAt = new Date(row.starts_at).getTime();
  const endsAt = row.ends_at ? new Date(row.ends_at).getTime() : null;
  return startsAt <= now && (endsAt === null || now <= endsAt);
}
