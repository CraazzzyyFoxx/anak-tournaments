/**
 * Form model of one `PickBanConfig`, and the pure logic the editor needs.
 *
 * The wire shape is deliberately not the form shape. Three of its fields are
 * traps an organizer cannot be expected to reason about, and each is resolved
 * here instead of being handed over raw:
 *
 *   1. `preset` decides whether `sequence` is used at all. The engine rebuilds
 *      the step order from the match's `best_of` unless `preset === "custom"`
 *      (`pick_ban_session.ensure_pick_ban_session`), so a hand-authored
 *      sequence saved with any other preset is silently discarded. The form
 *      therefore exposes the choice as `orderMode` and derives `preset` from
 *      it — never the other way round.
 *   2. `sequence` must be non-empty and internally valid even in bracket order:
 *      `validate_pick_ban_config` runs regardless of preset. Bracket order
 *      stores a generated placeholder for the scope's series length, the same
 *      way the legacy veto editor does.
 *   3. `unique_attribute_per_side_per_round` only ever means `"role"`, and only
 *      for hero configs (`pick_ban_action._attribute_lookup` never resolves it
 *      for `kind=map`). The form models it as a boolean on hero configs alone.
 *
 * `first_pick_rule` is omitted entirely: its type has exactly one member, and
 * the server defaults to it, so a control would be a dead choice.
 */
import {
  DEFAULT_BEST_OF,
  buildSequenceForBestOf,
  hasPerRoundBestOf,
  parseStageBestOf,
  resolveBestOf,
} from "@/lib/best-of";
import type {
  MapVetoMode,
  PickBanConfig,
  PickBanConfigUpsertInput,
  PickBanFirstBanRotation,
  PickBanKind,
  PickBanNoRepeatScope,
  PickBanSequenceToken,
  Stage,
} from "@/types/tournament.types";

/** Candidates a slot needs to ban down to a survivor. Mirrors `pick_ban_session.SLOT_CANDIDATE_FLOOR`. */
export const SLOT_CANDIDATE_FLOOR = 2;

/** The only `unique_attribute_per_side_per_round` value the engine implements. */
const ROLE_ATTRIBUTE = "role";

/** The `preset` value that opts a config out of bracket-driven step order. */
const CUSTOM_PRESET = "custom";
/** The `preset` value that opts a config into it. Any non-`custom` value would do. */
const BRACKET_PRESET = "bracket";

/** Where a config's step order comes from. */
export type PickBanOrderMode = "bracket" | "custom";

export type PickBanStepAction = "ban" | "pick" | "protect";
export type PickBanStepSide = "first" | "second";

export const PICK_BAN_STEP_ACTIONS: PickBanStepAction[] = ["ban", "pick", "protect"];
export const PICK_BAN_STEP_SIDES: PickBanStepSide[] = ["first", "second"];

export const PICK_BAN_MODES: MapVetoMode[] = ["pool", "slots"];
export const PICK_BAN_ROTATIONS: PickBanFirstBanRotation[] = [
  "fixed",
  "alternate",
  "result_winner_first",
  "result_loser_first",
  "result_loser_choice",
];
export const PICK_BAN_NO_REPEAT_SCOPES: PickBanNoRepeatScope[] = [
  "none",
  "encounter",
  "encounter_same_side",
];

/** One slot as the editor holds it: no `position`, because list order is it. */
export interface PickBanDraftSlot {
  candidates: number[];
  reserveItemId: number | null;
}

/**
 * Every field one config's editor owns, typed. Ids are numbers rather than the
 * comma-separated strings the previous editor parsed on save, so an unparseable
 * value cannot exist in the first place.
 */
export interface PickBanDraft {
  /** Null for a config that does not exist yet. */
  configId: number | null;
  kind: PickBanKind;
  stageId: number | null;
  round: number | null;
  mode: MapVetoMode;
  orderMode: PickBanOrderMode;
  firstBanRotation: PickBanFirstBanRotation;
  noRepeatScope: PickBanNoRepeatScope;
  turnTimerSeconds: number | null;
  allowProtect: boolean;
  /** Hero configs only; a map config always sends null. */
  uniqueRolePerRound: boolean;
  /** Only read when `orderMode === "custom"` and `mode === "pool"`. */
  sequence: PickBanSequenceToken[];
  /** Pool mode only. */
  itemIds: number[];
  /** Slots mode only. */
  slots: PickBanDraftSlot[];
}

export function emptyPickBanDraft(kind: PickBanKind): PickBanDraft {
  return {
    configId: null,
    kind,
    stageId: null,
    round: null,
    mode: "pool",
    orderMode: "bracket",
    firstBanRotation: "fixed",
    noRepeatScope: "none",
    turnTimerSeconds: null,
    allowProtect: false,
    uniqueRolePerRound: false,
    sequence: [],
    itemIds: [],
    slots: [],
  };
}

export function pickBanDraftFromConfig(config: PickBanConfig): PickBanDraft {
  return {
    configId: config.id,
    kind: config.kind,
    stageId: config.stage_id,
    round: config.round,
    mode: config.mode,
    orderMode: config.preset === CUSTOM_PRESET ? "custom" : "bracket",
    firstBanRotation: config.first_ban_rotation,
    noRepeatScope: config.no_repeat_scope,
    turnTimerSeconds: config.turn_timer_seconds,
    allowProtect: config.allow_protect,
    uniqueRolePerRound: config.unique_attribute_per_side_per_round === ROLE_ATTRIBUTE,
    sequence: [...config.sequence],
    itemIds: [...config.item_ids],
    slots: config.slots.map((slot) => ({
      candidates: [...slot.candidates],
      reserveItemId: slot.reserve_item_id,
    })),
  };
}

/**
 * The sequence a draft actually stores.
 *
 * Bracket order keeps a generated placeholder rather than an empty list: the
 * server validates `sequence` on every pool-mode upsert, and the engine
 * regenerates it per match anyway.
 */
export function effectiveSequence(
  draft: PickBanDraft,
  seriesLength: number
): PickBanSequenceToken[] {
  if (draft.mode === "slots") return [];
  if (draft.orderMode === "custom") return draft.sequence;
  return buildSequenceForBestOf(seriesLength, draft.itemIds.length);
}

export function pickBanDraftToInput(
  draft: PickBanDraft,
  seriesLength: number
): PickBanConfigUpsertInput {
  const slotsMode = draft.mode === "slots";
  return {
    kind: draft.kind,
    stage_id: draft.stageId,
    round: draft.stageId != null ? draft.round : null,
    mode: draft.mode,
    first_ban_rotation: draft.firstBanRotation,
    // `ck_pick_ban_config_slots_not_custom` forbids the custom preset in slot
    // mode, where there is no hand-authored order to protect anyway.
    preset: slotsMode || draft.orderMode === "bracket" ? BRACKET_PRESET : CUSTOM_PRESET,
    turn_timer_seconds: draft.turnTimerSeconds,
    no_repeat_scope: draft.noRepeatScope,
    unique_attribute_per_side_per_round:
      draft.kind === "hero" && draft.uniqueRolePerRound ? ROLE_ATTRIBUTE : null,
    allow_protect: draft.allowProtect,
    sequence: effectiveSequence(draft, seriesLength),
    item_ids: slotsMode ? [] : draft.itemIds,
    slots: slotsMode
      ? draft.slots.map((slot) => ({
          candidates: slot.candidates,
          reserve_item_id: slot.reserveItemId,
        }))
      : [],
  };
}

// ── step tokens ──────────────────────────────────────────────────────────────

export interface PickBanStep {
  action: PickBanStepAction | "decider";
  /** Null only for `decider`. */
  side: PickBanStepSide | null;
}

export function parseStepToken(token: PickBanSequenceToken): PickBanStep {
  if (token === "decider") return { action: "decider", side: null };
  const [action, side] = token.split("_") as [PickBanStepAction, PickBanStepSide];
  return { action, side };
}

export function buildStepToken(
  action: PickBanStepAction | "decider",
  side: PickBanStepSide
): PickBanSequenceToken {
  return action === "decider" ? "decider" : (`${action}_${side}` as PickBanSequenceToken);
}

/** Rounds a sequence actually plays: every pick plus the decider. */
export function roundsPlayed(sequence: PickBanSequenceToken[]): number {
  return sequence.filter((token) => token !== "ban_first" && token !== "ban_second").length;
}

// ── scope ────────────────────────────────────────────────────────────────────

/**
 * A `<Select>` value for the scope row. Radix rejects an empty string, and
 * "tournament-wide" is not a stage id, so the two cases share one encoding.
 */
export const TOURNAMENT_SCOPE = "tournament";
/** A `<Select>` value for "every round of this stage". */
export const ALL_ROUNDS_SCOPE = "all";

export function encodeScope(stageId: number | null): string {
  return stageId == null ? TOURNAMENT_SCOPE : `stage:${stageId}`;
}

export function decodeScope(value: string): number | null {
  if (!value.startsWith("stage:")) return null;
  const id = Number(value.slice("stage:".length));
  return Number.isFinite(id) ? id : null;
}

/** The encounter fields the round list and the series length read. */
export interface PickBanScopeEncounter {
  stage_id: number | null;
  round: number;
  best_of: number;
}

/**
 * The rounds an organizer can scope a config to, ascending; empty until the
 * bracket is generated.
 *
 * Deliberately does not guess before that: elimination round numbering isn't
 * simple enough for a local fallback to get right (double elimination's
 * lower bracket uses negative round numbers, and single elimination's round
 * count depends on team count, not a stage's independently-set
 * `max_rounds`), and a wrong guess would let an organizer scope a config to
 * a round the eventual bracket never has. `PickBanConfigsTab` asks the
 * server to predict the real numbers before generation instead
 * (`adminService.getStagePlannedRounds`), which runs the actual bracket
 * generator against the stage's planned team inputs.
 */
export function stageRoundOptions(
  stageId: number,
  encounters: PickBanScopeEncounter[] | undefined
): number[] {
  return [
    ...new Set(
      (encounters ?? [])
        .filter((encounter) => encounter.stage_id === stageId)
        .map((encounter) => encounter.round)
    ),
  ].sort((left, right) => left - right);
}

/** How confident the editor is about the series length it is previewing. */
export type SeriesLengthSource = "round" | "stage" | "variesByRound" | "variesByMatch";

export interface SeriesLength {
  bestOf: number;
  source: SeriesLengthSource;
}

/**
 * The series length a scope plays, as the bracket defines it.
 *
 * Only `"round"` is exact. A stage-wide or tournament-wide config covers
 * matches of different lengths, so the value is a preview of the generated step
 * order, not a promise — the caller must label it as such.
 */
export function resolveSeriesLength(
  stageId: number | null,
  round: number | null,
  stages: Stage[],
  encounters: PickBanScopeEncounter[] | undefined
): SeriesLength {
  if (stageId == null) return { bestOf: DEFAULT_BEST_OF, source: "variesByMatch" };

  if (round != null) {
    const generated = (encounters ?? []).find(
      (encounter) => encounter.stage_id === stageId && encounter.round === round
    );
    if (generated != null && generated.best_of > 0) {
      return { bestOf: generated.best_of, source: "round" };
    }
  }

  const stage = stages.find((candidate) => candidate.id === stageId);
  const bestOfConfig = parseStageBestOf(stage?.settings_json ?? null);
  const bestOf = resolveBestOf(bestOfConfig, round ?? 1, {
    isFinal: round != null && stage != null && round === stage.max_rounds,
  });
  if (round != null) return { bestOf, source: "round" };
  return { bestOf, source: hasPerRoundBestOf(bestOfConfig) ? "variesByRound" : "stage" };
}

// ── validation ───────────────────────────────────────────────────────────────

/**
 * A rejection the editor can actually produce, as data: `key` resolves under
 * `pickBan.admin.validation.*` and `values` feeds its ICU arguments.
 *
 * Mirrors `validate_pick_ban_config` / `validate_pick_ban_slot_config`, minus
 * the rejections this editor makes unreachable — ids come from toggles, so they
 * can neither repeat nor be unparseable, and a reserve picker never offers its
 * own slot's candidates.
 */
export type PickBanValidationIssue =
  | { key: "emptyPool"; values?: undefined }
  | { key: "emptySequence"; values?: undefined }
  | { key: "multipleDeciders"; values?: undefined }
  | { key: "deciderNotLast"; values?: undefined }
  | { key: "noPickOrDecider"; values?: undefined }
  | { key: "sequenceLongerThanPool"; values: { steps: number; items: number } }
  | { key: "emptySlots"; values?: undefined }
  | { key: "slotTooFewCandidates"; values: { slot: number } };

export function validatePickBanDraft(
  draft: PickBanDraft,
  seriesLength: number
): PickBanValidationIssue[] {
  if (draft.mode === "slots") {
    if (draft.slots.length === 0) return [{ key: "emptySlots" }];
    return draft.slots.flatMap((slot, index) =>
      slot.candidates.length < SLOT_CANDIDATE_FLOOR
        ? [{ key: "slotTooFewCandidates" as const, values: { slot: index + 1 } }]
        : []
    );
  }

  const issues: PickBanValidationIssue[] = [];
  if (draft.itemIds.length === 0) issues.push({ key: "emptyPool" });

  const sequence = effectiveSequence(draft, seriesLength);
  if (sequence.length === 0) {
    // Reachable in custom order only: bracket order generates from the pool,
    // and an empty pool is already reported above.
    if (draft.itemIds.length > 0) issues.push({ key: "emptySequence" });
  } else {
    const deciders = sequence.filter((token) => token === "decider").length;
    if (deciders > 1) {
      issues.push({ key: "multipleDeciders" });
    } else if (deciders === 1 && sequence[sequence.length - 1] !== "decider") {
      issues.push({ key: "deciderNotLast" });
    }
    if (!sequence.some((token) => token.startsWith("pick") || token === "decider")) {
      issues.push({ key: "noPickOrDecider" });
    }
  }

  if (draft.itemIds.length > 0 && sequence.length > draft.itemIds.length) {
    issues.push({
      key: "sequenceLongerThanPool",
      values: { steps: sequence.length, items: draft.itemIds.length },
    });
  }
  return issues;
}

/**
 * Whether `allowProtect` is on but no step will ever run it.
 *
 * The toggle alone changes nothing: the engine only offers a protect action
 * where the resolved sequence carries a `protect_*` token, and a
 * bracket-generated order never does. Surfaced as a notice rather than a
 * validation error, because the server accepts the combination.
 */
export function protectHasNoStep(draft: PickBanDraft, seriesLength: number): boolean {
  if (!draft.allowProtect) return false;
  if (draft.mode === "slots") return true;
  return !effectiveSequence(draft, seriesLength).some((token) => token.startsWith("protect"));
}

/** The existing config a draft would overwrite on save, if any. */
export function findScopeCollision(
  draft: PickBanDraft,
  configs: PickBanConfig[]
): PickBanConfig | null {
  const round = draft.stageId != null ? draft.round : null;
  return (
    configs.find(
      (config) =>
        config.id !== draft.configId &&
        config.kind === draft.kind &&
        config.stage_id === draft.stageId &&
        config.round === round
    ) ?? null
  );
}

// ── catalogue search ─────────────────────────────────────────────────────────

/** Diacritic- and curly-quote-insensitive, case-folded form of a catalogue name. */
function normalizeItemName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\u2019/g, "'")
    .toLowerCase();
}

/**
 * Does `query` name `name`? Used by the map and hero pickers, where an
 * organizer types what a paper regulation or cast calls a map/hero rather
 * than the catalogue's exact spelling. A plain substring test alone misses
 * two common mismatches; an empty query matches everything.
 */
export function matchesItemName(name: string, query: string): boolean {
  const needle = normalizeItemName(query).trim();
  if (needle === "") return true;
  const haystack = normalizeItemName(name);
  // "Shambali" for "Shambali Monastery": the query drops a trailing word.
  if (haystack.includes(needle)) return true;
  // "Peninsular" for "Antarctic Peninsula": the query adds letters to a word
  // the catalogue carries, which no substring test reaches from either side.
  // Accept a query one of the name's words is a prefix of, from three
  // characters up so a short word cannot drag in unrelated entries.
  return haystack.split(/\s+/).some((word) => word.length >= 3 && needle.startsWith(word));
}
