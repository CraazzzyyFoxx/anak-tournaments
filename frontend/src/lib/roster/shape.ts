/**
 * The roster slot vocabulary the server speaks.
 *
 * There is deliberately NO domain rule here. What a valid roster shape is, what
 * it falls back to, how many draft rounds it implies -- all of that lives once,
 * in `backend/shared/domain/roster_shape.py`, and reaches the frontend as a
 * resolved `RosterShape`. Recomputing any of it here would recreate exactly the
 * mirror this feature exists to delete.
 */

/**
 * A slot code is a role code of the owner game's rated dimension, or `flex`: the open-slot
 * transport sentinel (any role). The server's projection follows the tournament's team format, so
 * the vocabulary is the game's own and never a fixed list; names and order come from the scoped
 * ontology (`lib/roster/ontology.ts`).
 */
export type SlotCode = string;

/** The open slot: it fixes no role and is never a role reference. */
export const OPEN_SLOT_CODE = "flex";

/** A projected slot map: positive counts, in the server's order. An in-progress editor map may hold zeros. */
export type RosterSlotMap = Partial<Record<SlotCode, number>>;

/**
 * A resolved roster shape exactly as `shared.schemas.roster_slots.RosterShapeRead`
 * serializes it. Every derived value is a server field: read `team_size`,
 * `draft_rounds` and `has_role_slots` from here, never recompute them.
 */
export interface RosterShape {
  dimension: string | null;
  /** Normalized: no zero counts, canonical order. */
  slots: RosterSlotMap;
  team_size: number;
  flex_slots: number;
  /** `false` only when every slot is flex, i.e. no slot asks for a role. */
  has_role_slots: boolean;
  draft_rounds: number;
  /** The owner copy, workspace template, or module preset. */
  source: "tournament" | "custom_game" | "workspace" | "preset" | null;
}

/** Present codes in the server's (canonical) order. Absent (and zeroed) codes are dropped. */
export function slotCodesOf(slots: RosterSlotMap): SlotCode[] {
  return Object.keys(slots).filter((code) => (slots[code] ?? 0) > 0);
}

// ponytail: the draft room still types slots as the legacy Overwatch union; `orderSlotCodes` keeps that
// typing for it (UI-bal moves the draft onto `slotCodesOf` + the ontology and deletes this with it).
export function orderSlotCodes(slots: RosterSlotMap): RosterSlotCode[] {
  return slotCodesOf(slots) as RosterSlotCode[];
}

/** Every slot code except the open slot asks for a specific role. */
export function isRoleSlot(code: string): boolean {
  return code !== OPEN_SLOT_CODE;
}

// ponytail: legacy Overwatch role union, kept only for the draft room's role-keyed translations (UI-bal
// deletes it with `isRoleSlotCode` when it moves those onto the ontology); registration reads `isRoleSlot`.
export type RosterRoleSlotCode = "tank" | "damage" | "support";

/** Legacy Overwatch slot union (draft room only); registration speaks {@link SlotCode}. */
export type RosterSlotCode = RosterRoleSlotCode | "flex";

export function isRoleSlotCode(code: string): code is RosterRoleSlotCode {
  return isRoleSlot(code);
}

// ponytail: legacy Overwatch vocabulary, kept only for BalancerConfigDrawer's role label (UI-bal
// deletes both with that caller); nothing in registration reads it.
const LEGACY_SLOT_CODES: readonly string[] = ["tank", "damage", "support", "flex"];

export function isRosterSlotCode(code: string): boolean {
  return LEGACY_SLOT_CODES.includes(code);
}
