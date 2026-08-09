import { buildSequenceForBestOf } from "@/lib/best-of";
import type {
  FirstBanRotation,
  MapVetoConfig,
  MapVetoMode,
  Stage,
  VetoSequenceToken
} from "@/types/tournament.types";

export type VetoStepAction = "ban" | "pick" | "decider";
export type VetoStepSide = "first" | "second";

export const BO2_SEQUENCE: VetoSequenceToken[] = [
  "ban_first",
  "ban_second",
  "pick_first",
  "pick_second"
];

export const BO3_SEQUENCE: VetoSequenceToken[] = [
  "ban_first",
  "ban_second",
  "pick_first",
  "pick_second",
  "decider"
];

export const BO5_SEQUENCE: VetoSequenceToken[] = [
  "ban_first",
  "ban_second",
  "pick_first",
  "pick_second",
  "pick_first",
  "pick_second",
  "decider"
];

/** Bo1: alternating bans (first team starts) until one map remains, then a decider. */
export function buildBo1Sequence(poolSize: number): VetoSequenceToken[] {
  const sequence: VetoSequenceToken[] = [];
  for (let index = 0; index < poolSize - 1; index += 1) {
    sequence.push(index % 2 === 0 ? "ban_first" : "ban_second");
  }
  sequence.push("decider");
  return sequence;
}

export function tokenAction(token: VetoSequenceToken): VetoStepAction {
  if (token === "decider") return "decider";
  return token.startsWith("ban") ? "ban" : "pick";
}

export function tokenSide(token: VetoSequenceToken): VetoStepSide | null {
  if (token === "decider") return null;
  return token.endsWith("_first") ? "first" : "second";
}

export function buildToken(action: VetoStepAction, side: VetoStepSide): VetoSequenceToken {
  if (action === "decider") return "decider";
  return `${action}_${side}` as VetoSequenceToken;
}

/**
 * Message-key suffix for a step token. Callers resolve it under
 * `mapVeto.step.*` — the helper stays locale-agnostic so the same token
 * renders correctly on the RU and EN sides of the app.
 */
export type VetoStepLabelKey = "banFirst" | "banSecond" | "pickFirst" | "pickSecond" | "decider";

export function tokenLabelKey(token: VetoSequenceToken): VetoStepLabelKey {
  switch (token) {
    case "ban_first":
      return "banFirst";
    case "ban_second":
      return "banSecond";
    case "pick_first":
      return "pickFirst";
    case "pick_second":
      return "pickSecond";
    default:
      return "decider";
  }
}

/**
 * Maps actually played in a series: every pick plus the decider. Derived from
 * the stored sequence rather than the preset label, so a hand-edited custom
 * sequence reports the truth instead of its nearest preset.
 */
export function getMapsPlayedCount(sequence: VetoSequenceToken[]): number {
  return sequence.filter((token) => tokenAction(token) !== "ban").length;
}

/**
 * A validation failure as data, not prose: `key` resolves under
 * `mapVetoAdmin.validation.*` and `values` feeds ICU arguments.
 */
export type VetoValidationIssue =
  | {
      key: "emptyPool" | "emptySequence" | "multipleDeciders" | "deciderNotLast" | "noPickOrDecider";
      values?: undefined;
    }
  | { key: "sequenceLongerThanPool"; values: { steps: number; maps: number } }
  | { key: "slotTooFewCandidates"; values: { slot: number } };

/**
 * Candidates a slot needs to ban down to a survivor. Mirrors the backend
 * `SLOT_CANDIDATE_FLOOR` in `veto_session.py`.
 */
export const SLOT_CANDIDATE_FLOOR = 2;

/** Turn timer a level with no stored config starts from, in seconds. */
export const DEFAULT_TURN_TIMER_SECONDS = 30;

/** Which sequence a level runs: the bracket's, or one the organizer authored. */
export type VetoOrderMode = "bracket" | "custom";

/** One slot as the editor holds it: no `position`, because list order is it. */
export interface VetoDraftSlot {
  candidates: number[];
  reserve_map_id: number | null;
}

/**
 * Every field one cascade level's editor owns, in one value.
 *
 * Held by the tab rather than by the editor, so collapsing a level's row — which
 * unmounts the editor — cannot discard an organizer's in-progress work. Both
 * pool shapes are carried at once for the same reason a mis-click on the shape
 * toggle must not throw away up to fifteen selections that cannot be undone.
 */
export interface VetoDraft {
  mode: MapVetoMode;
  /** Flat mode only; the slot-mode payload sends an empty list instead. */
  mapIds: number[];
  /** The organizer's authored steps, kept even while the bracket drives them. */
  sequence: VetoSequenceToken[];
  orderMode: VetoOrderMode;
  /** Slot mode only, in play order; the server derives positions 1..N from it. */
  slots: VetoDraftSlot[];
  firstBanRotation: FirstBanRotation;
  turnTimerSeconds: number | null;
}

/**
 * The draft a level opens on, derived from its stored config alone.
 *
 * Pure and total, so the tab can re-derive it on every render and treat the
 * presence of a stored draft — not a mount-time effect — as "the organizer has
 * touched this level". That is what keeps a map-catalogue refetch from reverting
 * an edit in progress.
 *
 * A saved config contributes its flat pool only when it has one: a slot config
 * reports `map_ids: []` by design (`serialize_veto_config`), so seeding from it
 * left the flat shape with nothing selected and Save refused the moment an
 * organizer touched the shape toggle — while a level with no config at all
 * starts from the whole catalogue. Same emptiness on the wire, same start.
 *
 * Only an explicit `custom` preset opts a level out of the bracket: a legacy
 * `bo*` label and a NULL preset are both bracket-driven, and the server
 * regenerates their steps from `Encounter.best_of`.
 */
export function seedVetoDraft(
  config: MapVetoConfig | null,
  /** Maps the bracket plays in this scope's series: one slot each. */
  bestOf: number,
  /** Every competitive map, in catalogue order — the flat default. */
  catalogueIds: number[]
): VetoDraft {
  const mapIds = config && config.map_ids.length > 0 ? [...config.map_ids] : [...catalogueIds];
  // Sorted by `position` rather than trusted in array order: the read carries an
  // explicit position per slot while the upsert derives it from the list.
  const stored = [...(config?.slots ?? [])]
    .sort((left, right) => left.position - right.position)
    .map((slot) => ({ candidates: [...slot.candidates], reserve_map_id: slot.reserve_map_id }));
  return {
    mode: config?.mode ?? "pool",
    mapIds,
    // Sized from the pool just resolved to, not from `config.map_ids`: a slot
    // config's empty list would make this `buildSequenceForBestOf(bestOf, 0)`.
    sequence:
      config && config.sequence.length > 0
        ? [...config.sequence]
        : buildSequenceForBestOf(bestOf, mapIds.length),
    orderMode: config?.preset === "custom" ? "custom" : "bracket",
    // Exactly `bestOf` entries: a shorter stored config gains empty rows to
    // fill, a longer one is cut to what the bracket plays. Either disagreement
    // is named by the slot-count warning, which reads the stored length.
    slots: Array.from(
      { length: Math.max(bestOf, 0) },
      (_, index) => stored[index] ?? { candidates: [], reserve_map_id: null }
    ),
    firstBanRotation: config?.first_ban_rotation ?? "fixed",
    turnTimerSeconds: config ? config.turn_timer_seconds : DEFAULT_TURN_TIMER_SECONDS
  };
}

function sameNumbers(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Whether two drafts describe the same configuration. Drives the unsaved marker,
 * so it compares every field the save payload reads — including the ones the
 * currently selected pool shape does not send, because switching back to the
 * other shape would send them.
 */
export function vetoDraftsEqual(left: VetoDraft, right: VetoDraft): boolean {
  return (
    left.mode === right.mode &&
    left.orderMode === right.orderMode &&
    left.firstBanRotation === right.firstBanRotation &&
    left.turnTimerSeconds === right.turnTimerSeconds &&
    sameNumbers(left.mapIds, right.mapIds) &&
    left.sequence.length === right.sequence.length &&
    left.sequence.every((token, index) => token === right.sequence[index]) &&
    left.slots.length === right.slots.length &&
    left.slots.every(
      (slot, index) =>
        slot.reserve_map_id === right.slots[index].reserve_map_id &&
        sameNumbers(slot.candidates, right.slots[index].candidates)
    )
  );
}

/**
 * The editor's fields for one pool shape. Discriminated rather than one
 * positional pair, because the two shapes share no rule: every flat check fires
 * on a valid slot draft, which is why the tab used to skip validation entirely
 * in slot mode.
 */
export type VetoConfigFormShape =
  | { mode: "pool"; sequence: VetoSequenceToken[]; mapIds: number[] }
  | { mode: "slots"; slots: { candidates: number[] }[] };

/** Mirrors backend config-upsert validation so errors surface before save. */
export function validateVetoConfigForm(form: VetoConfigFormShape): VetoValidationIssue[] {
  if (form.mode === "slots") {
    // The per-slot floor is the one `validate_slot_config` rejection an
    // organizer can produce from this editor. The others cannot be reached: the
    // list is never empty because there is one card per map of the series, a
    // tile toggle removes on the second click so candidates cannot repeat, and
    // the reserve picker never offers the slot's own candidates.
    //
    // `slot` is the 1-based position the server derives from list order, so the
    // message names the same slot the API would.
    return form.slots.flatMap((slot, index) =>
      slot.candidates.length < SLOT_CANDIDATE_FLOOR
        ? [{ key: "slotTooFewCandidates" as const, values: { slot: index + 1 } }]
        : []
    );
  }
  const { sequence, mapIds } = form;
  const issues: VetoValidationIssue[] = [];
  if (mapIds.length === 0) {
    issues.push({ key: "emptyPool" });
  }
  if (sequence.length === 0) {
    issues.push({ key: "emptySequence" });
  } else {
    const deciderCount = sequence.filter((token) => token === "decider").length;
    if (deciderCount > 1) {
      issues.push({ key: "multipleDeciders" });
    } else if (deciderCount === 1 && sequence[sequence.length - 1] !== "decider") {
      issues.push({ key: "deciderNotLast" });
    }
    if (!sequence.some((token) => tokenAction(token) !== "ban")) {
      issues.push({ key: "noPickOrDecider" });
    }
  }
  if (mapIds.length > 0 && sequence.length > mapIds.length) {
    issues.push({
      key: "sequenceLongerThanPool",
      values: { steps: sequence.length, maps: mapIds.length }
    });
  }
  return issues;
}

/**
 * Which cascade level a config sits on, as data. Callers render it through
 * `mapVeto.scope.*` so the stage name is interpolated in the active locale.
 * `stageName` is null when the stage is outside the loaded set, letting the
 * caller fall back to a translated placeholder rather than an English one.
 */
export type VetoLevelDescriptor =
  | { kind: "tournament" }
  | { kind: "stage"; stageId: number; stageName: string | null }
  | { kind: "stageRound"; stageId: number; stageName: string | null; round: number };

export function getVetoLevelDescriptor(
  config: Pick<MapVetoConfig, "stage_id" | "round">,
  stagesById: Map<number, Stage>
): VetoLevelDescriptor {
  const stageId = config.stage_id;
  if (stageId == null) return { kind: "tournament" };
  const stageName = stagesById.get(stageId)?.name ?? null;
  if (config.round == null) return { kind: "stage", stageId, stageName };
  return { kind: "stageRound", stageId, stageName, round: config.round };
}

/**
 * Fold a map name to the form the regulation's spellings compare equal under:
 * case, combining diacritics, and the typographic apostrophe U+2019 against the
 * typewriter U+0027. `Paraiso` for `Paraíso` and `King's` for `King’s` are the
 * two the catalogue actually carries.
 */
export function normalizeMapName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\u2019/g, "'")
    .toLowerCase();
}

/**
 * Does `query` name `name`? Used by the slot editor's name filter, where an
 * organizer types what the paper regulation says rather than what the catalogue
 * calls the map. An empty query matches everything.
 */
export function matchesMapName(name: string, query: string): boolean {
  const needle = normalizeMapName(query).trim();
  if (needle === "") return true;
  const haystack = normalizeMapName(name);
  // `Shambali` for `Shambali Monastery`: the regulation drops a trailing word.
  if (haystack.includes(needle)) return true;
  // `Peninsular` for `Antarctic Peninsula`: the regulation adds letters to a
  // word the catalogue carries, which no substring test reaches from either
  // side. Accept a query one of the name's words is a prefix of, from three
  // characters up so a short word cannot drag in unrelated maps.
  return haystack.split(/\s+/).some((word) => word.length >= 3 && needle.startsWith(word));
}

