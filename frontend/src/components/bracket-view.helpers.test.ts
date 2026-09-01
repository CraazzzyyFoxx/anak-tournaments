import { describe, expect, it } from "bun:test";

import type { Encounter, EncounterSlotSource } from "@/types/encounter.types";
import {
  bracketRoundLabel,
  buildRoundGroups,
  computeMatchNumbers,
  computeSlotHints,
  getDoubleEliminationFinalRounds,
  getRoundSectionMatchCapacity,
  stageFinalRounds
} from "@/components/bracket-view.helpers";

function createEncounter(id: number, round: number, sources?: EncounterSlotSource[]): Encounter {
  return {
    id,
    created_at: new Date(0),
    updated_at: null,
    name: "TBD vs TBD",
    home_team_id: 0,
    away_team_id: 0,
    score: { home: 0, away: 0 },
    round,
    best_of: 3,
    tournament_id: 1,
    stage_id: 1,
    stage_item_id: 1,
    challonge_id: null,
    status: "open",
    closeness: null,
    has_logs: false,
    result_status: "none",
    scheduled_at: null,
    started_at: null,
    ended_at: null,
    current_map_index: null,
    confirmed_at: null,
    matches: [],
    home_team: null as never,
    away_team: null as never,
    tournament: null as never,
    stage: null,
    stage_item: null,
    sources
  };
}

describe("bracket view helpers", () => {
  it("uses the widest upper round to reserve section height for bye brackets", () => {
    const rounds = buildRoundGroups([
      createEncounter(1, 1),
      createEncounter(2, 2),
      createEncounter(3, 2),
      createEncounter(4, 2),
      createEncounter(5, 2),
      createEncounter(6, 3),
      createEncounter(7, 3),
      createEncounter(8, 4)
    ]);

    expect(rounds.map((round) => round.matches.length)).toEqual([1, 4, 2, 1]);
    expect(getRoundSectionMatchCapacity(rounds)).toBe(4);
  });

  it("shows loser source hints for lower bracket slots in double elimination", () => {
    const encounters = [
      createEncounter(1, 1),
      createEncounter(2, 1),
      createEncounter(3, 1),
      createEncounter(4, 1),
      createEncounter(5, 2),
      createEncounter(6, 2),
      createEncounter(7, 3),
      createEncounter(8, 4),
      createEncounter(9, -1),
      createEncounter(10, -1),
      createEncounter(11, -2),
      createEncounter(12, -2),
      createEncounter(13, -3),
      createEncounter(14, -4)
    ];

    const finalRoundNumbers = getDoubleEliminationFinalRounds(encounters);
    const upperRounds = buildRoundGroups(
      encounters.filter((match) => match.round > 0 && !finalRoundNumbers.has(match.round))
    );
    const lowerRounds = buildRoundGroups(encounters.filter((match) => match.round < 0));
    const finalRounds = buildRoundGroups(
      encounters.filter((match) => match.round > 0 && finalRoundNumbers.has(match.round))
    );
    const matchNumbers = computeMatchNumbers(upperRounds, lowerRounds, finalRounds);
    const hints = computeSlotHints(upperRounds, lowerRounds, finalRounds, matchNumbers, true, true);

    expect(hints.get(9)).toEqual({
      home: `L M${matchNumbers.get(1)}`,
      away: `L M${matchNumbers.get(2)}`
    });
    expect(hints.get(10)).toEqual({
      home: `L M${matchNumbers.get(3)}`,
      away: `L M${matchNumbers.get(4)}`
    });
    expect(hints.get(11)).toEqual({
      home: `W M${matchNumbers.get(9)}`,
      away: `L M${matchNumbers.get(5)}`
    });
    expect(hints.get(12)).toEqual({
      home: `W M${matchNumbers.get(10)}`,
      away: `L M${matchNumbers.get(6)}`
    });
  });

  it("skips missing source hints for uneven double elimination rounds", () => {
    const encounters = [
      createEncounter(1, 1),
      createEncounter(2, 2),
      createEncounter(3, 3),
      createEncounter(4, -1)
    ];

    const finalRoundNumbers = getDoubleEliminationFinalRounds(encounters);
    const upperRounds = buildRoundGroups(
      encounters.filter((match) => match.round > 0 && !finalRoundNumbers.has(match.round))
    );
    const lowerRounds = buildRoundGroups(encounters.filter((match) => match.round < 0));
    const finalRounds = buildRoundGroups(
      encounters.filter((match) => match.round > 0 && finalRoundNumbers.has(match.round))
    );
    const matchNumbers = computeMatchNumbers(upperRounds, lowerRounds, finalRounds);

    const hints = computeSlotHints(upperRounds, lowerRounds, finalRounds, matchNumbers, true, true);

    expect(hints.get(4)).toEqual({
      home: `L M${matchNumbers.get(1)}`,
      away: null
    });
  });
});

// The bracket lays rounds out from encounters; the pick-ban scope picker offers
// them as a list, sometimes before any encounter exists. Both name a round
// through `bracketRoundLabel`, so the same round cannot read "Round 3" in one
// place and "Grand Final" in the other.
describe("bracket round names", () => {
  const generated = [
    createEncounter(1, 1),
    createEncounter(2, 1),
    createEncounter(3, 2),
    createEncounter(4, 3),
    createEncounter(5, -1),
    createEncounter(6, -2)
  ];

  it("names the same round identically from a laid-out bracket and from a round list", () => {
    const fromBracket = [...getDoubleEliminationFinalRounds(generated)].sort(
      (left, right) => left - right
    );
    const rounds = [...new Set(generated.map((match) => match.round))];
    const fromPicker = stageFinalRounds(1, "double_elimination", rounds, generated);

    expect(fromPicker).toEqual(fromBracket);
    for (const round of rounds) {
      expect(bracketRoundLabel(round, fromPicker)).toEqual(
        bracketRoundLabel(round, fromBracket)
      );
    }
  });

  it("calls a double elimination's deciding round the grand final, and its rematch a reset", () => {
    const withReset = [...generated, createEncounter(7, 4)];
    const finalRounds = stageFinalRounds(
      1,
      "double_elimination",
      [...new Set(withReset.map((match) => match.round))],
      withReset
    );

    expect(finalRounds).toEqual([3, 4]);
    expect(bracketRoundLabel(2, finalRounds)).toEqual({ key: "round", n: 2 });
    expect(bracketRoundLabel(3, finalRounds)).toEqual({ key: "grandFinal" });
    expect(bracketRoundLabel(4, finalRounds)).toEqual({ key: "grandFinalReset" });
    expect(bracketRoundLabel(-2, finalRounds)).toEqual({ key: "lowerRound", n: 2 });
  });

  it("reads the highest round of a predicted bracket as the grand final -- one never has a reset", () => {
    const finalRounds = stageFinalRounds(1, "double_elimination", [-2, -1, 1, 2, 3], undefined);

    expect(finalRounds).toEqual([3]);
    expect(bracketRoundLabel(3, finalRounds)).toEqual({ key: "grandFinal" });
  });

  it("leaves a single elimination's rounds plain -- it has no grand final", () => {
    const finalRounds = stageFinalRounds(1, "single_elimination", [1, 2, 3], generated);

    expect(finalRounds).toEqual([]);
    expect(bracketRoundLabel(3, finalRounds)).toEqual({ key: "round", n: 3 });
  });
});

// 2026-08-14: tournament 84's playoff seeds its lower bracket straight from the
// group stage, so LOWER R1 holds those seeds and its slots really are TBD. The
// hints were inferred from the standard shape instead, which labelled them the
// losers of UB R1 -- teams that in fact drop into LOWER R2. The bracket's own
// advancement edges settle it.
describe("slot hints follow the bracket's recorded advancement edges", () => {
  //  UB: M1, M2 -> M3 (UB Final)      LB: M4, M5 (seeded) -> M6, M7 -> M8 -> M9
  const encounters = [
    createEncounter(1, 1),
    createEncounter(2, 1),
    createEncounter(3, 2, [
      { encounter_id: 1, role: "winner", slot: "home" },
      { encounter_id: 2, role: "winner", slot: "away" }
    ]),
    createEncounter(4, -1),
    createEncounter(5, -1),
    createEncounter(6, -2, [
      { encounter_id: 4, role: "winner", slot: "home" },
      { encounter_id: 1, role: "loser", slot: "away" }
    ]),
    createEncounter(7, -2, [
      { encounter_id: 5, role: "winner", slot: "home" },
      { encounter_id: 2, role: "loser", slot: "away" }
    ]),
    createEncounter(8, -3, [
      { encounter_id: 6, role: "winner", slot: "home" },
      { encounter_id: 7, role: "winner", slot: "away" }
    ]),
    createEncounter(9, -4, [
      { encounter_id: 8, role: "winner", slot: "home" },
      { encounter_id: 3, role: "loser", slot: "away" }
    ]),
    createEncounter(10, 3, [
      { encounter_id: 3, role: "winner", slot: "home" },
      { encounter_id: 9, role: "winner", slot: "away" }
    ])
  ];

  function hintsFor(matches: Encounter[]) {
    const finalRoundNumbers = getDoubleEliminationFinalRounds(matches);
    const upperRounds = buildRoundGroups(
      matches.filter((match) => match.round > 0 && !finalRoundNumbers.has(match.round))
    );
    const lowerRounds = buildRoundGroups(matches.filter((match) => match.round < 0));
    const finalRounds = buildRoundGroups(
      matches.filter((match) => match.round > 0 && finalRoundNumbers.has(match.round))
    );
    const matchNumbers = computeMatchNumbers(upperRounds, lowerRounds, finalRounds);
    return {
      matchNumbers,
      hints: computeSlotHints(upperRounds, lowerRounds, finalRounds, matchNumbers, true, true)
    };
  }

  it("leaves a seeded lower-bracket round TBD instead of naming an upper-bracket loser", () => {
    const { hints } = hintsFor(encounters);

    expect(hints.get(4)).toBeUndefined();
    expect(hints.get(5)).toBeUndefined();
  });

  it("drops the upper bracket's first losers into the round that actually receives them", () => {
    const { matchNumbers, hints } = hintsFor(encounters);

    expect(hints.get(6)).toEqual({
      home: `W M${matchNumbers.get(4)}`,
      away: `L M${matchNumbers.get(1)}`
    });
    expect(hints.get(7)).toEqual({
      home: `W M${matchNumbers.get(5)}`,
      away: `L M${matchNumbers.get(2)}`
    });
  });

  it("hints the grand final from the two bracket champions", () => {
    const { matchNumbers, hints } = hintsFor(encounters);

    expect(hints.get(10)).toEqual({
      home: `W M${matchNumbers.get(3)}`,
      away: `W M${matchNumbers.get(9)}`
    });
  });

  it("falls back to the inferred shape for a bracket with no recorded edges", () => {
    const legacy = encounters.map((match) => createEncounter(match.id, match.round));
    const { matchNumbers, hints } = hintsFor(legacy);

    // No edges to read, so the standard shape is assumed: LB round 1 takes the
    // upper bracket's first losers.
    expect(hints.get(4)).toEqual({
      home: `L M${matchNumbers.get(1)}`,
      away: `L M${matchNumbers.get(2)}`
    });
  });
});
