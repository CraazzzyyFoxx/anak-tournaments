import type { Duel } from "@/lib/encounter/seats";
import type { StageType } from "@/types/tournament.types";

/** A duel's scoreline: slot 1 is `one`, slot 2 is `two`. */
export type EncounterScore = Duel<number>;

/** The `matchEdit.presetDescriptions.*` keys. */
type EncounterScoreDescription =
  | "firstSweep"
  | "firstClose"
  | "draw"
  | "secondClose"
  | "secondSweep";

export type EncounterScorePreset = EncounterScore & {
  label: string;
  description: EncounterScoreDescription;
};

export const GROUP_STAGE_SCORE_PRESETS: EncounterScorePreset[] = [
  { label: "2-0", description: "firstSweep", one: 2, two: 0 },
  { label: "2-1", description: "firstClose", one: 2, two: 1 },
  { label: "1-1", description: "draw", one: 1, two: 1 },
  { label: "1-2", description: "secondClose", one: 1, two: 2 },
  { label: "0-2", description: "secondSweep", one: 0, two: 2 },
];

export function clampScoreValue(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);

  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, Math.floor(parsed));
}

/** Stages that cannot end level: the finalizer rejects a draw on these with a 400. */
export function stageNeedsWinner(stageType: StageType | string | null | undefined): boolean {
  return stageType === "single_elimination" || stageType === "double_elimination";
}

/** The `matchEdit.presetDescriptions.*` key that words a scoreline. */
function describeScore({ one, two }: EncounterScore): EncounterScoreDescription {
  if (one === two) return "draw";
  if (one > two) return two === 0 ? "firstSweep" : "firstClose";
  return one === 0 ? "secondSweep" : "secondClose";
}

/**
 * All valid final scores for a best-of-N series, slot 1 first. Winner needs
 * `floor(N/2)+1` maps; the loser can take up to `N - w` (early clinch). Even
 * series (e.g. BO2) additionally allow a drawn `N/2 - N/2`.
 */
export function validSeriesScores(bestOf: number): EncounterScorePreset[] {
  if (!Number.isInteger(bestOf) || bestOf < 1) return [];
  const win = Math.floor(bestOf / 2) + 1;
  const maxLoser = bestOf - win;
  const scores: EncounterScore[] = [];
  for (let loser = 0; loser <= maxLoser; loser++) {
    scores.push({ one: win, two: loser });
  }
  if (bestOf % 2 === 0) {
    scores.push({ one: bestOf / 2, two: bestOf / 2 });
  }
  for (let loser = maxLoser; loser >= 0; loser--) {
    scores.push({ one: loser, two: win });
  }
  return scores.map((score) => ({
    ...score,
    label: `${score.one}-${score.two}`,
    description: describeScore(score)
  }));
}

/**
 * Quick-result presets for a given series length. Short series (BO1-BO3) show
 * their discrete valid outcomes; longer series (BO5+) return none — the form
 * falls back to manual entry only.
 */
export function getScorePresetsForBestOf(bestOf: number): EncounterScorePreset[] {
  if (!Number.isInteger(bestOf) || bestOf < 1 || bestOf > 3) return [];
  return validSeriesScores(bestOf);
}
