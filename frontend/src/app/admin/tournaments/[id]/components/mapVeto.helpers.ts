import type { MapVetoConfig, Stage, VetoSequenceToken } from "@/types/tournament.types";

export type VetoLevelType = "tournament" | "stage" | "stage_round";
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

