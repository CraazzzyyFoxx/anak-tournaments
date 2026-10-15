/**
 * The roster-shape editor's state machine, kept out of the component so it can
 * be tested without rendering: which mode a stored override maps to, what each
 * mode transition does to the slot counts, when the total is savable, what one
 * team's slots look like, and what goes on the wire.
 *
 * Domain rules still live on the server (`shared/domain/roster_shape.py`) and
 * reach the UI as a resolved `RosterShape`. The only thing duplicated here is
 * the savable-total bounds, which exist purely so the admin sees the verdict
 * before a round trip -- see the comment on them.
 */

import {
  ROSTER_PRESETS,
  ROSTER_SLOT_CODES,
  orderSlotCodes,
  presetForSlots,
  slotsTotal,
  type RosterPresetId,
  type RosterSlotCode,
  type RosterSlotMap
} from "@/lib/roster/shape";

/** Every selection edits an owned copy; no mode follows workspace changes. */
export type RosterShapeMode = RosterPresetId | "custom";

export const ROSTER_SHAPE_MODES: readonly RosterShapeMode[] = [
  ...ROSTER_PRESETS.map(({ id }) => id),
  "custom"
];

/**
 * Savable slot totals. The server owns this rule (`MIN_TEAM_SIZE` /
 * `MAX_TEAM_SIZE`); it is repeated here only to turn a guaranteed 422 into an
 * inline message, and the bounds are asserted against the server's own error
 * codes by the backend suite.
 */
export const MIN_ROSTER_TOTAL = 1;
export const MAX_ROSTER_TOTAL = 12;

/** Per-code stepper range. Zero means "no slot of this kind". */
export const MAX_SLOT_COUNT = MAX_ROSTER_TOTAL;

export interface RosterShapeSelection {
  mode: RosterShapeMode;
  /** The counts shown by the steppers and saved in the owner's format. */
  slots: RosterSlotMap;
}

export type RosterTotalError = "too_few" | "too_many";

/** Drop zeros and re-key in canonical order, matching what the server stores. */
export function normalizeSlots(slots: RosterSlotMap): RosterSlotMap {
  const normalized: RosterSlotMap = {};
  for (const code of orderSlotCodes(slots)) {
    normalized[code] = slots[code];
  }
  return normalized;
}

/** Which preset the owner's slot map matches, or custom. */
export function modeForOverride(override: RosterSlotMap): RosterShapeMode {
  return presetForSlots(override);
}

/** Seed a concrete draft from the owner's map, or its effective projection. */
export function initialSelection(
  override: RosterSlotMap | null,
  effective: RosterSlotMap
): RosterShapeSelection {
  const slots = normalizeSlots(override ?? effective);
  return {
    mode: modeForOverride(slots),
    slots
  };
}

/** A preset replaces the counts; custom keeps the current counts. */
export function selectMode(
  selection: RosterShapeSelection,
  mode: RosterShapeMode
): RosterShapeSelection {
  const preset = ROSTER_PRESETS.find(({ id }) => id === mode);
  return {
    mode,
    slots: preset ? normalizeSlots(preset.slots) : selection.slots
  };
}

/**
 * Stepper edit. Counts are clamped, and the mode is re-derived from the result:
 * hand-typing 1/2/2 snaps the select back to `Overwatch 5v5` rather than leaving
 * it lying that the shape is bespoke.
 */
export function setSlotCount(
  selection: RosterShapeSelection,
  code: RosterSlotCode,
  count: number
): RosterShapeSelection {
  const clamped = Math.min(Math.max(Math.round(count), 0), MAX_SLOT_COUNT);
  const slots = normalizeSlots({ ...selection.slots, [code]: clamped });
  return { mode: presetForSlots(slots), slots };
}

/**
 * Why the payload cannot be saved, if it cannot. Takes the payload rather than
 * the selection so the editor and the settings tab -- which holds only the
 * payload -- gate on the exact same check instead of two lookalikes.
 */
export function payloadTotalError(payload: RosterSlotMap): RosterTotalError | null {
  const total = slotsTotal(payload);
  if (total < MIN_ROSTER_TOTAL) return "too_few";
  if (total > MAX_ROSTER_TOTAL) return "too_many";
  return null;
}

/**
 * One team's slot list: one row per slot, so `{tank: 1, flex: 5}` reads
 * as one Tank and five Flex instead of a pair of counters the admin has to
 * expand in their head.
 */
export function previewSlotRows(slots: RosterSlotMap): RosterSlotCode[] {
  return ROSTER_SLOT_CODES.flatMap((code) =>
    Array.from({ length: slots[code] ?? 0 }, () => code)
  );
}

/** Stable normalized counts for the team-format transport and dirty check. */
export function slotsPayload(selection: RosterShapeSelection): RosterSlotMap {
  return normalizeSlots(selection.slots);
}
