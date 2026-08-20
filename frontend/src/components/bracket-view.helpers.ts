import type { Encounter } from "@/types/encounter.types";
import type { StageType } from "@/types/tournament.types";

export interface RoundGroup {
  round: number;
  matches: Encounter[];
}

export interface SlotHint {
  home: string | null;
  away: string | null;
}

function sortMatches(matches: Encounter[]) {
  return [...matches].sort((left, right) => {
    const leftKey = left.stage_item_id ?? left.challonge_id ?? left.id;
    const rightKey = right.stage_item_id ?? right.challonge_id ?? right.id;

    return leftKey - rightKey;
  });
}

export function buildRoundGroups(matches: Encounter[]): RoundGroup[] {
  const groups = new Map<number, Encounter[]>();

  for (const match of matches) {
    const existing = groups.get(match.round) ?? [];
    existing.push(match);
    groups.set(match.round, existing);
  }

  return [...groups.entries()]
    .sort((left, right) => Math.abs(left[0]) - Math.abs(right[0]))
    .map(([round, roundMatches]) => ({
      round,
      matches: sortMatches(roundMatches)
    }));
}

export function getRoundSectionMatchCapacity(rounds: RoundGroup[]): number {
  return Math.max(1, ...rounds.map((group) => group.matches.length));
}

export function computeMatchNumbers(
  upperRounds: RoundGroup[],
  lowerRounds: RoundGroup[],
  finalRounds: RoundGroup[]
): Map<number, number> {
  const numbers = new Map<number, number>();
  let counter = 1;
  for (const group of upperRounds) {
    for (const match of group.matches) {
      numbers.set(match.id, counter++);
    }
  }
  for (const group of lowerRounds) {
    for (const match of group.matches) {
      numbers.set(match.id, counter++);
    }
  }
  for (const group of finalRounds) {
    for (const match of group.matches) {
      numbers.set(match.id, counter++);
    }
  }
  return numbers;
}

/**
 * The signed rounds a bracket's Grand Final (and its reset) occupy — empty for
 * anything that has none.
 *
 * ``matchesPerRound`` tells the Grand Final apart from its reset the way the
 * bracket itself does: both are trailing single-match rounds, so the last
 * `trailing - 1` of them are finals and the one before is the upper-bracket
 * final. Without it — a bracket predicted before it exists, which never carries
 * a reset (`placeholder_bracket` omits it) — the highest positive round is the
 * Grand Final.
 */
function getFinalRounds(
  isDoubleElimination: boolean,
  rounds: number[],
  matchesPerRound?: Map<number, number>
): number[] {
  if (!isDoubleElimination) return [];

  const positive = rounds.filter((round) => round > 0).sort((left, right) => left - right);
  if (positive.length === 0) return [];
  if (!matchesPerRound) return positive.slice(-1);

  let trailingSingleMatchRounds = 0;
  for (let index = positive.length - 1; index >= 0; index -= 1) {
    if ((matchesPerRound.get(positive[index]) ?? 0) !== 1) break;
    trailingSingleMatchRounds += 1;
  }

  return positive.slice(-Math.max(1, trailingSingleMatchRounds - 1));
}

export function getDoubleEliminationFinalRounds(encounters: Encounter[]): Set<number> {
  const matchesPerRound = new Map<number, number>();
  for (const match of encounters) {
    matchesPerRound.set(match.round, (matchesPerRound.get(match.round) ?? 0) + 1);
  }
  return new Set(getFinalRounds(true, [...matchesPerRound.keys()], matchesPerRound));
}

/** The encounter fields `stageFinalRounds` reads. */
export interface StageScopedRound {
  stage_id: number | null;
  round: number;
}

/**
 * `getFinalRounds` for a screen that offers a stage's rounds as a list — the
 * pick-ban scope picker, the scrim pool copier — rather than laying the bracket
 * out. Counts the matches per round from the stage's encounters when they
 * exist; before that the round list alone decides, which is exact because a
 * predicted bracket never carries a Grand Final Reset.
 */
export function stageFinalRounds(
  stageId: number | null,
  stageType: StageType | undefined,
  rounds: number[],
  encounters: StageScopedRound[] | undefined
): number[] {
  if (stageType !== "double_elimination") return [];

  const matchesPerRound = new Map<number, number>();
  for (const encounter of encounters ?? []) {
    if (encounter.stage_id !== stageId) continue;
    matchesPerRound.set(encounter.round, (matchesPerRound.get(encounter.round) ?? 0) + 1);
  }
  return getFinalRounds(true, rounds, matchesPerRound.size > 0 ? matchesPerRound : undefined);
}

/** A round's name, as a `bracket.*` message key plus the depth it interpolates. */
export interface BracketRoundLabel {
  key: "round" | "lowerRound" | "grandFinal" | "grandFinalReset";
  /** Depth for the keys that interpolate `{n}`; absent for the finals. */
  n?: number;
}

/**
 * What the bracket calls this round. The one place that decides a round's name,
 * so every screen that offers one — the bracket itself, the pick-ban scope
 * picker — shows the organizer the same name for it. Render it with
 * `useBracketRoundLabel`.
 *
 * ``finalRounds`` comes from `getFinalRounds`; its first entry is the Grand
 * Final and anything after it a reset.
 */
export function bracketRoundLabel(round: number, finalRounds: number[]): BracketRoundLabel {
  if (round < 0) return { key: "lowerRound", n: -round };

  const finalIndex = finalRounds.indexOf(round);
  if (finalIndex < 0) return { key: "round", n: round };
  return { key: finalIndex === 0 ? "grandFinal" : "grandFinalReset" };
}

/**
 * Where each unresolved slot's team will come from, as "W M3" / "L M7".
 *
 * Reads the bracket's own advancement edges (`Encounter.sources`) when it has
 * them, so the hints are the real topology rather than a shape inferred from
 * round numbers -- an inference that cannot tell a lower bracket seeded straight
 * from the group stage (round 1 holds seeds, so those slots really are TBD) from
 * a standard one (round 1 holds the upper bracket's first losers), and got the
 * former wrong. `inferBracketSlotHints` remains for a bracket generated before
 * the edges were recorded.
 */
export function computeSlotHints(
  upperRounds: RoundGroup[],
  lowerRounds: RoundGroup[],
  finalRounds: RoundGroup[],
  matchNumbers: Map<number, number>,
  isDE: boolean,
  hasBracketConnections: boolean
): Map<number, SlotHint> {
  const groups = [...upperRounds, ...lowerRounds, ...finalRounds];
  const recorded = groups.some((group) => group.matches.some((match) => (match.sources?.length ?? 0) > 0));
  if (recorded) {
    const hints = new Map<number, SlotHint>();
    for (const group of groups) {
      for (const match of group.matches) {
        for (const source of match.sources ?? []) {
          const matchNumber = matchNumbers.get(source.encounter_id);
          if (matchNumber == null) continue;
          const existing = hints.get(match.id) ?? { home: null, away: null };
          hints.set(match.id, {
            ...existing,
            [source.slot]: `${source.role === "winner" ? "W" : "L"} M${matchNumber}`
          });
        }
      }
    }
    return hints;
  }

  return inferBracketSlotHints(
    upperRounds,
    lowerRounds,
    finalRounds,
    matchNumbers,
    isDE,
    hasBracketConnections
  );
}

/**
 * The pre-`sources` fallback: guesses each slot's origin from the standard
 * double-elimination shape. Only correct for a bracket that has that shape, so
 * it is reached only when no encounter carries a recorded edge.
 */
function inferBracketSlotHints(
  upperRounds: RoundGroup[],
  lowerRounds: RoundGroup[],
  finalRounds: RoundGroup[],
  matchNumbers: Map<number, number>,
  isDE: boolean,
  hasBracketConnections: boolean
): Map<number, SlotHint> {
  const hints = new Map<number, SlotHint>();

  function label(match: Encounter | undefined, prefix: "W" | "L") {
    if (!match) {
      return null;
    }

    const matchNumber = matchNumbers.get(match.id);
    return matchNumber != null ? `${prefix} M${matchNumber}` : null;
  }

  function setHint(target: Encounter, slot: keyof SlotHint, value: string | null) {
    if (!value) {
      return;
    }

    const existing = hints.get(target.id) ?? { home: null, away: null };
    hints.set(target.id, {
      ...existing,
      [slot]: value
    });
  }

  function trackEdges(
    groups: RoundGroup[],
    prefix: "W" | "L",
    mapper: (matchIndex: number, targetCount: number) => number
  ) {
    for (let groupIndex = 0; groupIndex < groups.length - 1; groupIndex += 1) {
      const current = groups[groupIndex].matches;
      const next = groups[groupIndex + 1].matches;
      const feedCount = new Map<number, number>();

      for (let matchIndex = 0; matchIndex < current.length; matchIndex += 1) {
        const targetIndex = mapper(matchIndex, next.length);
        if (targetIndex < 0 || targetIndex >= next.length) {
          continue;
        }

        const target = next[targetIndex];
        const source = current[matchIndex];
        const hintLabel = label(source, prefix);
        if (!hintLabel) {
          continue;
        }

        const count = feedCount.get(targetIndex) ?? 0;
        feedCount.set(targetIndex, count + 1);

        setHint(target, count === 0 ? "home" : "away", hintLabel);
      }
    }
  }

  if (hasBracketConnections) {
    trackEdges(upperRounds, "W", (matchIndex, targetCount) => {
      const targetIndex = Math.floor(matchIndex / 2);
      return targetIndex < targetCount ? targetIndex : -1;
    });
    trackEdges(lowerRounds, "W", (matchIndex, targetCount) => {
      if (targetCount === 0) {
        return -1;
      }
      return Math.min(matchIndex, targetCount - 1);
    });
  }

  if (isDE && upperRounds.length > 0 && lowerRounds.length > 0) {
    const firstLowerRound = lowerRounds[0];
    if (Math.abs(firstLowerRound.round) === 1) {
      firstLowerRound.matches.forEach((target, matchIndex) => {
        setHint(target, "home", label(upperRounds[0].matches[matchIndex * 2], "L"));
        setHint(target, "away", label(upperRounds[0].matches[matchIndex * 2 + 1], "L"));
      });
    }

    for (let upperRoundIndex = 1; upperRoundIndex < upperRounds.length; upperRoundIndex += 1) {
      const targetLowerRound = lowerRounds[upperRoundIndex * 2 - 1];
      if (!targetLowerRound) {
        continue;
      }

      targetLowerRound.matches.forEach((target, matchIndex) => {
        setHint(target, "away", label(upperRounds[upperRoundIndex].matches[matchIndex], "L"));
      });
    }
  }

  if (isDE && finalRounds.length > 0) {
    const grandFinal = finalRounds[0]?.matches[0];
    if (grandFinal) {
      const upperFinal = upperRounds[upperRounds.length - 1]?.matches[0];
      const lowerFinal = lowerRounds[lowerRounds.length - 1]?.matches[0];
      setHint(grandFinal, "home", upperFinal ? label(upperFinal, "W") : null);
      setHint(grandFinal, "away", lowerFinal ? label(lowerFinal, "W") : null);
    }
  }

  return hints;
}
