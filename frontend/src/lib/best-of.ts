/**
 * Series length as the bracket defines it.
 *
 * The bracket owns how many maps a match plays. The configuration lives in
 * `Stage.settings_json.best_of`, the generator resolves it per encounter into
 * `Encounter.best_of`, and an admin may override a single encounter from the
 * edit dialog. Every surface that needs to talk about Bo N — the stage editor,
 * the veto config editor, the public map-pool page — reads it from here so the
 * three cannot drift.
 *
 * `parseStageBestOf` / `resolveBestOf` mirror the backend's
 * `services/admin/best_of.py`, and `buildSequenceForBestOf` mirrors
 * `services/encounter/veto_session.py`. Keep them in step: the veto room runs
 * the backend's sequence, so a divergence here is a UI that previews steps the
 * captains will not be asked to take.
 */
import type { StageBestOfConfig } from "@/types/admin.types";
import type { StageType, VetoSequenceToken } from "@/types/tournament.types";

export const DEFAULT_BEST_OF = 3;

/** Series lengths the stage editor offers. Bo4/Bo6 are legal but unused. */
export const BEST_OF_OPTIONS = [1, 2, 3, 5, 7] as const;

/**
 * The `mapVeto.preset.*` message for a series length, or null when it has none.
 *
 * A bare template literal (`` `mapVeto.preset.bo${n}` ``) does not typecheck
 * against next-intl's key union, and a runtime membership check alone does not
 * narrow it. Returning the literal keys makes both the guard and the type one
 * decision, so a Bo4 stage renders `Bo4` instead of emitting a missing key.
 */
export function bestOfMessageKey(
  bestOf: number
):
  | "mapVeto.preset.bo1"
  | "mapVeto.preset.bo2"
  | "mapVeto.preset.bo3"
  | "mapVeto.preset.bo5"
  | "mapVeto.preset.bo7"
  | null {
  switch (bestOf) {
    case 1:
      return "mapVeto.preset.bo1";
    case 2:
      return "mapVeto.preset.bo2";
    case 3:
      return "mapVeto.preset.bo3";
    case 5:
      return "mapVeto.preset.bo5";
    case 7:
      return "mapVeto.preset.bo7";
    default:
      return null;
  }
}

/** Opening bans a generated sequence uses when the pool can spare them. */
const LEAD_BANS = 2;

/** An int >= 1, or null. Booleans are rejected, matching `_coerce_positive_int`. */
function positiveInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) return null;
  return value;
}

/**
 * Read `settings_json.best_of` defensively. Any malformed shape degrades to an
 * empty config rather than throwing — `settings_json` is free-form and predates
 * this feature, so old stages legitimately carry nothing here.
 */
export function parseStageBestOf(settingsJson: unknown): StageBestOfConfig {
  if (!settingsJson || typeof settingsJson !== "object") return {};
  const raw = (settingsJson as Record<string, unknown>).best_of;
  if (!raw || typeof raw !== "object") return {};
  const record = raw as Record<string, unknown>;

  const byRound: Record<string, number> = {};
  if (record.by_round && typeof record.by_round === "object") {
    for (const [key, value] of Object.entries(record.by_round as Record<string, unknown>)) {
      // Keys are round-number strings; anything else is ignored, as on the server.
      // Lower-bracket rounds are negative ("LB rounds use negative round numbers" in
      // `_create_encounters_from_skeleton`, services/admin/stage.py), and the backend's
      // `parse_best_of_config` accepts them. Dropping them here would make this mirror
      // disagree with the server on an LB round's series length.
      if (!/^-?\d+$/.test(key)) continue;
      const coerced = positiveInt(value);
      if (coerced !== null) byRound[key] = coerced;
    }
  }

  const config: StageBestOfConfig = {};
  const fallback = positiveInt(record.default);
  if (fallback !== null) config.default = fallback;
  const final = positiveInt(record.final);
  if (final !== null) config.final = final;
  if (Object.keys(byRound).length > 0) config.by_round = byRound;
  return config;
}

/**
 * Resolve the series length for one round. Precedence matches the backend:
 * `final` (elimination stages, last round) -> `by_round[round]` -> `default`.
 *
 * `isFinal` is the caller's call because the server decides it from the max
 * round of the *generated* encounter set, which the client cannot see. Callers
 * previewing a stage approximate it with `max_rounds` and should present the
 * result as the configured value rather than a promise.
 */
export function resolveBestOf(
  config: StageBestOfConfig,
  round: number,
  { isFinal = false }: { isFinal?: boolean } = {}
): number {
  if (isFinal && config.final != null) return config.final;
  const byRound = config.by_round?.[String(round)];
  if (byRound != null) return byRound;
  return config.default ?? DEFAULT_BEST_OF;
}

/** True when a stage's rounds do not all play the same series length. */
export function hasPerRoundBestOf(config: StageBestOfConfig): boolean {
  return Object.keys(config.by_round ?? {}).length > 0 || config.final != null;
}

/** A round the best-of editor can target, identified by its `by_round` key. */
export interface BestOfRoundOption {
  /** Signed round number — negative is a lower-bracket round. */
  round: number;
  label: string;
}

/** A group of rounds in the editor; `label === null` renders as a flat list. */
export interface BestOfRoundSection {
  key: string;
  label: string | null;
  rounds: BestOfRoundOption[];
}

export interface StageBestOfShape {
  stageType: StageType;
  /** `Stage.max_rounds`. A fallback used only when the team count is unknown. */
  maxRounds: number;
  /**
   * The team count that fixes this bracket's depth: total teams for single
   * elimination, upper-bracket teams (post-split) for double elimination.
   * `0` when nothing is seeded and no count can be derived, which falls back
   * to `maxRounds`.
   */
  bracketTeamCount?: number;
  /** DE "split" seeding: half the teams start in the lower bracket. */
  splitLowerBracket?: boolean;
  /** Round keys already configured, so an override is never hidden. */
  configuredRounds?: number[];
}

/**
 * The rounds the best-of editor offers, grouped by bracket.
 *
 * Double elimination numbers its rounds by sign — upper bracket 1..U, grand
 * final U+1, lower bracket -1..-L (`services/bracket/double_elimination.py`) —
 * so a single flat `Round 1..max_rounds` list can neither reach a lower-bracket
 * round nor say which bracket a positive round belongs to. Organizers who want
 * "Bo5 in the upper bracket only" reached for `default` instead, which lengthens
 * every match in both brackets.
 *
 * The grand final is NOT offered here: `final` already targets it (and takes
 * precedence over `by_round`), so giving it a second key would let the two
 * disagree with `final` silently winning.
 *
 * The depth is derived from the team count, exact for the power-of-two sizes
 * the generator builds cleanly and possibly over-counting a lower bracket
 * shortened by first-round byes. Over-counting is the safe direction: a key no
 * encounter carries is inert, while a missing row is a round the organizer
 * cannot configure at all. `maxRounds` is only a last-resort fallback for a
 * bracket whose team count is still unknown — it is an independent admin
 * planning field, not the real round count.
 */
export function stageBestOfRoundSections({
  stageType,
  maxRounds,
  bracketTeamCount = 0,
  splitLowerBracket = false,
  configuredRounds = []
}: StageBestOfShape): BestOfRoundSection[] {
  const flatRounds = Math.max(1, Math.floor(maxRounds) || 1);

  if (stageType === "single_elimination") {
    // Round count is `ceil(log2(teams))` (`services/bracket/single_elimination.py`),
    // NOT `max_rounds` — a 5-team and a 32-team bracket carry different depths a
    // shared planning default cannot express.
    const rounds = bracketTeamCount >= 2 ? Math.ceil(Math.log2(bracketTeamCount)) : flatRounds;
    return withUnlistedRounds(
      [
        {
          key: "rounds",
          label: null,
          rounds: countUp(rounds).map((round) => ({ round, label: `Round ${round}` }))
        }
      ],
      configuredRounds
    );
  }

  if (stageType !== "double_elimination") {
    // Swiss / round-robin play a flat `1..max_rounds` the caller already knows.
    return withUnlistedRounds(
      [
        {
          key: "rounds",
          label: null,
          rounds: countUp(flatRounds).map((round) => ({ round, label: `Round ${round}` }))
        }
      ],
      configuredRounds
    );
  }

  // `maxRounds` counts the grand final, the bracket's rounds do not.
  const upperRounds =
    bracketTeamCount >= 2 ? Math.ceil(Math.log2(bracketTeamCount)) : Math.max(1, flatRounds - 1);

  // Each upper round after the first drops losers into a lower round and the
  // survivors play a reduction round; lower-bracket seeds add an opening round
  // plus the reduction that merges them with the upper bracket's first losers.
  const lowerRounds = Math.max(0, 2 * (upperRounds - 1) + (splitLowerBracket ? 2 : 0));

  const sections: BestOfRoundSection[] = [
    {
      key: "upper",
      label: "Upper bracket",
      rounds: countUp(upperRounds).map((round) => ({
        round,
        label: upperBracketRoundLabel(round, upperRounds)
      }))
    }
  ];
  if (lowerRounds > 0) {
    sections.push({
      key: "lower",
      label: "Lower bracket",
      rounds: countUp(lowerRounds).map((depth) => ({
        round: -depth,
        label: depth === lowerRounds ? "LB Final" : `LB Round ${depth}`
      }))
    });
  }
  return withUnlistedRounds(sections, configuredRounds);
}

function countUp(count: number): number[] {
  return Array.from({ length: Math.max(0, count) }, (_, index) => index + 1);
}

/** Mirrors `_ub_round_label`, minus the per-match index the editor has no use for. */
function upperBracketRoundLabel(round: number, upperRounds: number): string {
  if (round === upperRounds) return "UB Final";
  if (round === upperRounds - 1) return "UB Semifinal";
  return `UB Round ${round}`;
}

/**
 * Append any configured round the sections above do not offer.
 *
 * The offered depth is derived, so a stage whose bracket is a different shape
 * than the derivation assumed (or one configured before this editor grouped its
 * rounds) can carry a `by_round` key with nowhere to render. Such a key still
 * changes matches, so it gets a row rather than becoming an invisible override.
 */
function withUnlistedRounds(
  sections: BestOfRoundSection[],
  configuredRounds: number[]
): BestOfRoundSection[] {
  const offered = new Set(sections.flatMap((section) => section.rounds.map((row) => row.round)));
  const unlisted = [...new Set(configuredRounds)]
    .filter((round) => !offered.has(round))
    .sort((left, right) => right - left);
  if (unlisted.length === 0) return sections;
  return [
    ...sections,
    {
      key: "other",
      label: "Other configured rounds",
      rounds: unlisted.map((round) => ({
        round,
        label: round < 0 ? `LB Round ${-round}` : `Round ${round}`
      }))
    }
  ];
}

/**
 * Generate the veto step sequence that plays exactly `bestOf` maps.
 *
 * A pair of opening bans, then alternating picks, then a decider when the
 * series length is odd. This reproduces the Bo2/Bo3/Bo5 shapes the editor used
 * to hardcode and extends to any N, so a bracket configured Bo7 has a sequence.
 * Bo1 is the exception: its standard veto bans the pool down to one map.
 *
 * Opening bans are dropped as needed to keep the sequence no longer than the
 * pool, which is what the server validates on upsert.
 */
export function buildSequenceForBestOf(bestOf: number, poolSize: number): VetoSequenceToken[] {
  if (poolSize < 1) return [];
  if (bestOf <= 1) {
    const bans: VetoSequenceToken[] = Array.from({ length: poolSize - 1 }, (_, index) =>
      index % 2 === 0 ? "ban_first" : "ban_second"
    );
    return [...bans, "decider"];
  }

  // A pool smaller than the series cannot play the whole series; clamp rather
  // than preview steps the engine would run off the end of.
  const played = Math.min(bestOf, poolSize);
  const pickCount = played % 2 === 1 ? played - 1 : played;
  const banCount = Math.max(0, Math.min(LEAD_BANS, poolSize - played));

  const tokens: VetoSequenceToken[] = Array.from({ length: banCount }, (_, index) =>
    index % 2 === 0 ? "ban_first" : "ban_second"
  );
  for (let index = 0; index < pickCount; index += 1) {
    tokens.push(index % 2 === 0 ? "pick_first" : "pick_second");
  }
  if (played % 2 === 1) tokens.push("decider");
  return tokens;
}
