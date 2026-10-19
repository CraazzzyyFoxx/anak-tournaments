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

/** Every slot code except the open slot asks for a specific role. */
export function isRoleSlot(code: string): boolean {
  return code !== OPEN_SLOT_CODE;
}

/**
 * A solver/config role spelling as a slot code. A game's role codes are lower-case; the solver echoes the spelling of
 * the mask it was given, so a saved or legacy payload may say `Tank` for the code `tank`.
 */
export function solverSlotCode(role: string): SlotCode {
  return role.trim().toLowerCase();
}

// ponytail: legacy Overwatch role union, kept only for `roles.ts::RoleCode` (the mix tree's remaining fixed role
// vocabulary; UI-bal's mix migration deletes both); everything else speaks {@link SlotCode}.
export type RosterRoleSlotCode = "tank" | "damage" | "support";
