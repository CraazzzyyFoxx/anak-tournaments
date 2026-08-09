import type {
  EncounterMapPoolEntry,
  EncounterMapPoolState,
  MapPoolEntryStatus,
  MapVetoAction,
  VetoUnavailableReason,
} from "@/types/tournament.types";

export type VetoSide = "home" | "away";
export type VetoStepAction = MapVetoAction | "decider";

export interface ParsedVetoStep {
  token: string;
  action: VetoStepAction;
  side: VetoSide | null;
}

/** Resolved sequence tokens are "ban_home" / "pick_away" / "decider". */
export function parseStepToken(token: string): ParsedVetoStep {
  if (token === "decider") {
    return { token, action: "decider", side: null };
  }
  const [action, side] = token.split("_");
  return {
    token,
    action: action === "pick" ? "pick" : "ban",
    side: side === "away" ? "away" : "home",
  };
}

/** Picked/played maps in their final play order (action_index, legacy `order` fallback). */
export function pickedMapsInOrder(pool: EncounterMapPoolEntry[]): EncounterMapPoolEntry[] {
  return pool
    .filter((entry) => entry.status === "picked" || entry.status === "played")
    .sort(
      (left, right) =>
        (left.action_index ?? left.order) - (right.action_index ?? right.order),
    );
}

/**
 * Epoch-ms deadline of the current turn, or null when the timer indicator
 * should not be shown (no timer configured, session inactive, veto complete).
 */
export function turnDeadlineMs(state: EncounterMapPoolState): number | null {
  const session = state.session;
  if (!session || session.status !== "active" || state.is_complete) return null;
  if (session.turn_timer_seconds == null || !session.current_step_started_at) return null;
  const startedAt = Date.parse(session.current_step_started_at);
  if (Number.isNaN(startedAt)) return null;
  return startedAt + session.turn_timer_seconds * 1000;
}

/** Which empty-room icon a cause warrants; the room resolves it to a component. */
export type VetoUnavailableIcon = "teams" | "unconfigured" | "misconfigured";

export interface VetoUnavailableCopy {
  /** Keys relative to the `encounters.veto.room` namespace. */
  titleKey: string;
  hintKey: string;
  icon: VetoUnavailableIcon;
}

/**
 * Title, hint and icon for every reason the room can be closed — one entry per
 * cause. There is no fallback for an unmapped reason anywhere; the room's `??`
 * only substitutes for `reason` being ABSENT, which is a different hole.
 *
 * The room used to collapse the reason set into `reason === "teams_unknown"`,
 * and TypeScript never objected: comparing a widened union against one literal
 * is legal. So from the moment the backend could answer `slot_count_mismatch`
 * or `slot_underfilled`, both rendered "Veto is not configured — check back
 * later" and nothing signalled it: no type error, no test. That is a captain
 * being told to wait for an organizer action that waiting cannot produce.
 *
 * This total `Record` is the ONLY compile-time guard standing there, and it is
 * new. It has to live here, in production code: `tsconfig.json` excludes every
 * `.test.ts` and `.test.tsx` file, so an exhaustiveness assertion written in a
 * test would never be type-checked and would leave `tsc` green as the union grew.
 *
 * `satisfies` forces a fifth union member to be GIVEN an entry — it cannot stop
 * that entry from being pointed at another cause's strings, so
 * `veto-model.test.ts` additionally asserts at runtime that every reason
 * resolves to distinct non-empty copy in both locales. Keep both halves.
 *
 * `as const satisfies` rather than a type annotation: the annotation would widen
 * the key strings away from the literals `useTranslations`' typed `t` needs,
 * while `satisfies` still rejects a missing reason.
 */
export const VETO_UNAVAILABLE_COPY = {
  not_configured: {
    titleKey: "empty.notConfiguredTitle",
    hintKey: "empty.notConfiguredHint",
    icon: "unconfigured",
  },
  teams_unknown: {
    titleKey: "empty.teamsUnknownTitle",
    hintKey: "empty.teamsUnknownHint",
    icon: "teams",
  },
  // Both slot causes describe a config that EXISTS and disagrees with the
  // bracket, so neither may borrow `not_configured`'s "check back later".
  slot_count_mismatch: {
    titleKey: "empty.slotCountMismatchTitle",
    hintKey: "empty.slotCountMismatchHint",
    icon: "misconfigured",
  },
  slot_underfilled: {
    titleKey: "empty.slotUnderfilledTitle",
    hintKey: "empty.slotUnderfilledHint",
    icon: "misconfigured",
  },
} as const satisfies Record<VetoUnavailableReason, VetoUnavailableCopy>;

export interface VetoPoolSlot {
  /**
   * The config slot's `position`, NOT this group's index: deleting a middle slot
   * leaves a gap, so positions can read 1, 3, 7.
   */
  slot: number;
  entries: EncounterMapPoolEntry[];
}

/**
 * `pool` grouped by slot in ascending play order, or null for a flat pool.
 *
 * Mode is read off the entries' `slot` and never off
 * `EncounterMapPoolState.current_slot`, which goes null again the instant a slot
 * veto completes — inferring mode from it renders a finished slot veto as a flat
 * one.
 */
export function poolSlotGroups(pool: EncounterMapPoolEntry[]): VetoPoolSlot[] | null {
  const bySlot = new Map<number, EncounterMapPoolEntry[]>();
  for (const entry of pool) {
    if (entry.slot == null) continue;
    const bucket = bySlot.get(entry.slot);
    if (bucket) bucket.push(entry);
    else bySlot.set(entry.slot, [entry]);
  }
  if (bySlot.size === 0) return null;
  return [...bySlot.entries()]
    .sort(([left], [right]) => left - right)
    .map(([slot, entries]) => ({ slot, entries }));
}

export interface VetoSlotSteps extends VetoPoolSlot {
  /** Positions in the session `sequence` that resolve this slot, ascending. */
  stepIndices: number[];
}

/**
 * The session `sequence` split across the slots it resolves, or null for a flat
 * pool.
 *
 * The server's `build_slot_sequence` lays a slot-mode sequence out slot by slot
 * and spends exactly one step per candidate — `candidates - 1` bans plus the
 * decider that closes the slot — so each slot claims as many consecutive steps
 * as it has pool entries. Those entries ride along so the timeline can ask
 * `slotState` about a group directly, instead of pairing two lists up by index
 * — slot positions are gapped, so a positional pairing is a bug waiting for the
 * first deleted middle slot.
 */
export function stepSlotGroups(
  sequence: string[],
  pool: EncounterMapPoolEntry[],
): VetoSlotSteps[] | null {
  const groups = poolSlotGroups(pool);
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

export type VetoSlotState = "current" | "resolved" | "upcoming";

/**
 * Where `group` stands, given the server's `current_slot`.
 *
 * `current_slot` is null for a completed veto as well as a flat one, so
 * "resolved" is decided by the group having nothing left to ban rather than by
 * comparing against it.
 */
export function slotState(group: VetoPoolSlot, currentSlot: number | null): VetoSlotState {
  if (group.slot === currentSlot) return "current";
  return group.entries.some((entry) => entry.status === "available") ? "upcoming" : "resolved";
}

/**
 * Whether the viewer may select `entry` right now.
 *
 * The slot half restates the server's `in_current_slot` from the entry's side: a
 * flat entry carries no slot and so has no slot to be outside of, while an
 * upcoming slot's candidates stay `available` and are still not in play. That
 * pair — `available` yet unselectable — does not occur in flat mode, so the grid
 * has to render it as inert rather than merely un-highlighted.
 *
 * It is stricter than the server helper in one spot: with slots present and no
 * live slot, this answers false where `in_current_slot(entry, None)` answers
 * true. Unreachable in practice, since `canSelect` is already false for a
 * completed veto, and false is the safe answer either way.
 */
export function isEntrySelectable(
  entry: EncounterMapPoolEntry,
  { canSelect, currentSlot }: { canSelect: boolean; currentSlot: number | null },
): boolean {
  if (!canSelect || entry.status !== "available") return false;
  return entry.slot == null || entry.slot === currentSlot;
}

export type VetoStatusLabelKey = `maps.status.${MapPoolEntryStatus | "remaining"}`;

/**
 * Which `maps.status.*` key labels `entry`.
 *
 * `remaining` is deliberately NOT reachable by indexing with `entry.status`:
 * it is not a `MapPoolEntryStatus` member, so the grid's old
 * `` t(`maps.status.${entry.status}`) `` could never produce it. What identifies
 * a slot survivor is a PAIR — the server's `auto_complete_decider_entry` sets
 * `status = "picked"` together with `picked_by = "decider"`, meaning nobody
 * picked it, it was the last candidate standing.
 *
 * The slot gate is the third condition and it is load-bearing: a flat-mode
 * trailing decider carries the same `picked`/`decider` pair, and that one really
 * is the series' decider map, so it keeps saying "Picked". Mode is read off this
 * entry's own `slot`, never off `EncounterMapPoolState.current_slot`.
 */
export function statusLabelKey(entry: EncounterMapPoolEntry): VetoStatusLabelKey {
  if (entry.slot != null && entry.status === "picked" && entry.picked_by === "decider") {
    return "maps.status.remaining";
  }
  return `maps.status.${entry.status}`;
}
