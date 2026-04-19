import type { Encounter } from "@/types/encounter.types";

export function sortStandingsMatches(matches: Encounter[]): Encounter[] {
  if (matches.length === 0) {
    return [];
  }

  const maxAbsRound = Math.max(...matches.map((match) => Math.abs(match.round)));

  return [...matches].sort((left, right) => {
    const leftFinalFlag = Math.abs(left.round) === maxAbsRound ? 1 : 0;
    const rightFinalFlag = Math.abs(right.round) === maxAbsRound ? 1 : 0;

    if (leftFinalFlag !== rightFinalFlag) {
      return leftFinalFlag - rightFinalFlag;
    }

    const leftAbsRound = Math.abs(left.round);
    const rightAbsRound = Math.abs(right.round);

    if (leftAbsRound !== rightAbsRound) {
      return leftAbsRound - rightAbsRound;
    }

    const leftUpperBracketFirst = left.round > 0 ? 0 : 1;
    const rightUpperBracketFirst = right.round > 0 ? 0 : 1;

    if (leftUpperBracketFirst !== rightUpperBracketFirst) {
      return leftUpperBracketFirst - rightUpperBracketFirst;
    }

    return left.id - right.id;
  });
}
