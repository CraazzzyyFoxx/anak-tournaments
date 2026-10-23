import type { SlotCode, RosterSlotMap } from "@/lib/roster/shape";

/** Names a slot code: the owner game's role name, or the open slot's label. */
export type SlotLabelTranslator = (code: SlotCode) => string;

/**
 * "What this roster still needs", rendered from the structured `open_slots` map.
 *
 * The API also ships a ready-made `shortfall` string, built by the backend's
 * `RosterOccupancy.describe_shortfall()`, which reads `"1x damage, 2x support"` — raw
 * slot codes in an English shape, and it was being interpolated verbatim into a
 * Russian sentence. Building it here fixes that.
 *
 * The labels come from the owner game's ontology (see `useSlotLabel`), the SAME
 * names the slot chips elsewhere in these cards use, so one card never reads
 * "1× DPS" in its shortfall and "Damage" on its invite chip. Codes are listed in
 * the server's order, which follows the tournament's team format.
 *
 * The server's field stays the source of TRUTH — it is computed against the
 * tournament's real roster shape. This owns only the presentation of the same
 * numbers, which is where presentation belongs.
 */
export function formatShortfall(openSlots: RosterSlotMap, slotLabel: SlotLabelTranslator): string {
  return Object.entries(openSlots)
    .filter(([, count]) => (count ?? 0) > 0)
    .map(([code, count]) => `${count}× ${slotLabel(code)}`)
    .join(", ");
}
