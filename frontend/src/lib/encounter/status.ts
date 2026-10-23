import { duelSeats, duelWinner } from "@/lib/encounter/seats";
import type { Encounter } from "@/types/encounter.types";

/**
 * The single source of truth for "what state is this series in, and who won it".
 *
 * There used to be two disagreeing implementations: `EncountersTable`'s
 * `getMatchMeta` (winner only once the series is completed) and the encounters
 * route's `getWinnerSide` (winner purely by score, so a live 1–0 already
 * rendered a "winner"). The completed-aware reading is the correct one, so it
 * is the one that survives here.
 */

/**
 * Raw English state SENTINEL. It doubles as a stable map key for the
 * `encounters.state.*` translations — callers MUST translate before rendering.
 */
export type EncounterState = "Live" | "Upcoming" | "Final" | "Pending" | "Open";

/**
 * Backend statuses that mean "this series is over". A fixed table, because the
 * API has shipped all three spellings over time. The only copy: the bracket and
 * the public match cards read it through `isEncounterCompleted` too.
 */
const COMPLETED_STATUSES: Record<string, true> = {
  completed: true,
  finished: true,
  closed: true
};

export function isEncounterCompleted(encounter: Pick<Encounter, "status">): boolean {
  return COMPLETED_STATUSES[encounter.status] === true;
}

export function isEncounterLive(encounter: Pick<Encounter, "is_live">): boolean {
  return encounter.is_live;
}

export function getEncounterState(encounter: Encounter, now = new Date()): EncounterState {
  if (isEncounterLive(encounter)) return "Live";
  if (isEncounterCompleted(encounter)) return "Final";
  const scheduledAt = encounter.scheduled_at ? new Date(encounter.scheduled_at) : null;
  if (scheduledAt && scheduledAt.getTime() > now.getTime()) return "Upcoming";
  if (encounter.status === "pending") return "Pending";
  return "Open";
}

/**
 * Slot (1 or 2) of the seat that won the duel, or `null` while the series is
 * unfinished or drawn. A seat's `placement` decides when the writer set one;
 * otherwise the higher standing does.
 */
export function getEncounterWinner(encounter: {
  status: string;
  teams: readonly { slot: number; score: number; placement?: number | null }[];
}): 1 | 2 | null {
  if (!isEncounterCompleted(encounter)) return null;
  const [one, two] = duelSeats(encounter.teams);
  if (one == null || two == null) return null;
  if (one.placement != null && two.placement != null && one.placement !== two.placement) {
    return one.placement < two.placement ? 1 : 2;
  }
  return duelWinner({ one: one.score, two: two.score });
}
