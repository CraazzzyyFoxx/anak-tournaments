/**
 * Pure helpers for the generic pick-ban room (map + hero kinds).
 *
 * Sibling of `@/components/veto/veto-model.ts`, NOT a drop-in replacement:
 * the new engine is round-based (`PickBanEntry.round`) rather than slot-based,
 * adds `protect` as a third action, and drops the `map_id`/`slot` naming for
 * the pool-agnostic `item_id`/`round`. The legacy map-veto room keeps using
 * its own model until the cutover (design:
 * docs/plans/2026-08-09-generic-pickban-engine.md).
 */
import type {
  PickBanAction,
  PickBanEntry,
  PickBanEntryStatus,
  PickBanSession,
  PickBanState,
  VetoUnavailableReason,
} from "@/types/tournament.types";

export type PickBanSide = "home" | "away";
export type PickBanStepAction = PickBanAction | "decider";

export interface ParsedPickBanStep {
  token: string;
  action: PickBanStepAction;
  side: PickBanSide | null;
}

/** Resolved sequence tokens are "ban_home" / "pick_away" / "protect_home" / "decider". */
export function parseStepToken(token: string): ParsedPickBanStep {
  if (token === "decider") {
    return { token, action: "decider", side: null };
  }
  const [action, side] = token.split("_");
  const resolvedAction: PickBanAction = action === "pick" ? "pick" : action === "protect" ? "protect" : "ban";
  return {
    token,
    action: resolvedAction,
    side: side === "away" ? "away" : "home",
  };
}

/** Picked/played items in their final play order (action_index, legacy `order` fallback). */
export function pickedItemsInOrder(pool: PickBanEntry[]): PickBanEntry[] {
  return pool
    .filter((entry) => entry.status === "picked" || entry.status === "played")
    .sort((left, right) => (left.action_index ?? left.order) - (right.action_index ?? right.order));
}

/**
 * Epoch-ms deadline of the current turn, or null when the timer indicator
 * should not be shown (no timer configured, session inactive, sequence
 * complete).
 */
export function turnDeadlineMs(state: PickBanState): number | null {
  const session = state.session;
  if (!session || session.status !== "active" || state.is_complete) return null;
  if (session.turn_timer_seconds == null || !session.current_step_started_at) return null;
  const startedAt = Date.parse(session.current_step_started_at);
  if (Number.isNaN(startedAt)) return null;
  return startedAt + session.turn_timer_seconds * 1000;
}

/** Which empty-room icon a cause warrants; the room resolves it to a component. */
export type PickBanUnavailableIcon = "teams" | "unconfigured" | "misconfigured";

export interface PickBanUnavailableCopy {
  /** Keys relative to the `pickBan.room` namespace. */
  titleKey: string;
  hintKey: string;
  icon: PickBanUnavailableIcon;
}

/**
 * Title, hint and icon for every reason the room can be closed — one entry per
 * `VetoUnavailableReason`. The pick-ban engine's config cascade resolves
 * identically for kind=map and kind=hero (same shape, different catalog), so
 * it reuses the SAME reason set the map-veto room already has copy for
 * (backend: `pick_ban_action.get_pick_ban_state` docstring).
 */
export const PICK_BAN_UNAVAILABLE_COPY = {
  not_configured: {
    titleKey: "notConfiguredTitle",
    hintKey: "notConfiguredHint",
    icon: "unconfigured",
  },
  teams_unknown: {
    titleKey: "teamsUnknownTitle",
    hintKey: "teamsUnknownHint",
    icon: "teams",
  },
  slot_count_mismatch: {
    titleKey: "slotCountMismatchTitle",
    hintKey: "slotCountMismatchHint",
    icon: "misconfigured",
  },
  slot_underfilled: {
    titleKey: "slotUnderfilledTitle",
    hintKey: "slotUnderfilledHint",
    icon: "misconfigured",
  },
} as const satisfies Record<VetoUnavailableReason, PickBanUnavailableCopy>;

export interface PickBanRoundGroup {
  /** The round (map-of-the-series) this group resolves; 1-based. */
  round: number;
  entries: PickBanEntry[];
}

/**
 * `pool` grouped by round in ascending play order, or null for a flat
 * (non-progressive) pool.
 *
 * Mode is read off the entries' `round`, never off `PickBanState.current_round`
 * — which goes null again the instant the sequence completes, so inferring
 * mode from it would render a finished progressive session as a flat one.
 */
export function poolRoundGroups(pool: PickBanEntry[]): PickBanRoundGroup[] | null {
  const byRound = new Map<number, PickBanEntry[]>();
  for (const entry of pool) {
    if (entry.round == null) continue;
    const bucket = byRound.get(entry.round);
    if (bucket) bucket.push(entry);
    else byRound.set(entry.round, [entry]);
  }
  if (byRound.size === 0) return null;
  return [...byRound.entries()]
    .sort(([left], [right]) => left - right)
    .map(([round, entries]) => ({ round, entries }));
}

export interface PickBanStepRoundGroup extends PickBanRoundGroup {
  /** Positions in the session `sequence` that resolve this round, ascending. */
  stepIndices: number[];
}

/**
 * The session `sequence` split across the rounds it resolves, or null for a
 * flat pool. Mirrors `veto-model.stepSlotGroups`: each round claims as many
 * consecutive steps as it has pool entries, riding the entries along so the
 * timeline can ask `roundState` about a group directly.
 */
export function stepRoundGroups(sequence: string[], pool: PickBanEntry[]): PickBanStepRoundGroup[] | null {
  const groups = poolRoundGroups(pool);
  if (groups === null) return null;
  let cursor = 0;
  return groups.map((group) => {
    const end = Math.min(cursor + group.entries.length, sequence.length);
    const stepIndices: number[] = [];
    for (let index = cursor; index < end; index += 1) stepIndices.push(index);
    cursor = end;
    return { ...group, stepIndices };
  });
}

export type PickBanRoundState = "current" | "resolved" | "upcoming";

/**
 * Where `group` stands, given the server's `current_round`.
 *
 * `current_round` is null for a completed sequence as well as a flat one, so
 * "resolved" is decided by the group having nothing left to act on rather
 * than by comparing against it.
 */
export function roundState(group: PickBanRoundGroup, currentRound: number | null): PickBanRoundState {
  if (group.round === currentRound) return "current";
  return group.entries.some((entry) => entry.status === "available") ? "upcoming" : "resolved";
}

/**
 * Whether the viewer may select `entry` right now.
 *
 * Mirrors `veto-model.isEntrySelectable`, generalized to `round` and to the
 * `protected` status: a protected entry is never selectable by a `ban` (the
 * grid still shows it as `available`-looking to no one, since `protect` is
 * a same-side immunity, not a public "safe" marker other sides can act around
 * differently — the server is the single source of truth for what a click
 * resolves to, this only gates whether the click fires at all).
 */
export function isEntrySelectable(
  entry: PickBanEntry,
  { canSelect, currentRound }: { canSelect: boolean; currentRound: number | null },
): boolean {
  if (!canSelect || entry.status !== "available") return false;
  return entry.round == null || entry.round === currentRound;
}

export type PickBanStatusLabelKey = `status.${PickBanEntryStatus | "remaining"}`;

/**
 * Which `status.*` key labels `entry`.
 *
 * `remaining` mirrors `veto-model.statusLabelKey`'s decider-survivor case:
 * reachable only in round mode, when nobody picked the entry and it is simply
 * what the sequence left standing.
 */
export function statusLabelKey(entry: PickBanEntry): PickBanStatusLabelKey {
  if (entry.round != null && entry.status === "picked" && entry.picked_by === "decider") {
    return "status.remaining";
  }
  return `status.${entry.status}`;
}

/** Session presence gate shared by every action affordance in the room. */
export function isSessionActive(session: PickBanSession | null): boolean {
  return session != null && session.status === "active";
}
