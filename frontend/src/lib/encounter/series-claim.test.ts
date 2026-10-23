import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api/error";
import {
  encounterEnded,
  seriesClaimErrors,
  seriesReportErrorCodes,
  type SeriesClaim
} from "@/lib/encounter/series-claim";
import type { EncounterGame } from "@/types/tournament.types";

const A = 10;
const B = 11;

function game(position: number, a: number, b: number): EncounterGame {
  return {
    id: position,
    position,
    map_id: null,
    state: "confirmed",
    result_source: "captain_agreement",
    result_version: 1,
    confirmed_at: null,
    teams: [A, B].map((id, index) => ({
      encounter_team_id: id,
      score: index === 0 ? a : b,
      placement: null,
      column_values: {},
      starting_side: null,
      replay_code: null
    }))
  };
}

function claim(gamesPlayed: number, a: number, b: number): SeriesClaim {
  return { gamesPlayed, totals: { [A]: a, [B]: b }, wins: { [A]: a, [B]: b } };
}

function errors(c: SeriesClaim, games: EncounterGame[] = []) {
  return seriesClaimErrors({ preset: "wins", bestOf: 3, teamIds: [A, B], games, claim: c });
}

describe("seriesClaimErrors", () => {
  it("accepts a 2:1 and a 2:0 in a Bo3", () => {
    expect(errors(claim(3, 2, 1))).toEqual([]);
    expect(errors(claim(2, 2, 0))).toEqual([]);
  });

  it("rejects a series that is not over", () => {
    expect(errors(claim(2, 1, 1))).toEqual(["series_claim_not_final"]);
  });

  it("rejects a 3:0 in a Bo3: it was over after two games", () => {
    expect(errors(claim(3, 3, 0))).toContain("series_claim_unreachable");
  });

  it("rejects more games than the card holds or fewer than are confirmed", () => {
    expect(errors(claim(4, 2, 2))).toContain("series_claim_games_played");
    expect(errors(claim(2, 2, 0), [game(1, 5, 1), game(2, 5, 1), game(3, 5, 1)])).toContain(
      "series_claim_games_played"
    );
  });

  it("rejects fewer wins than are confirmed", () => {
    expect(errors(claim(3, 1, 2), [game(1, 5, 1), game(2, 5, 1)])).toContain("series_claim_wins");
  });

  it("checks the totals only once every claimed game is confirmed", () => {
    expect(errors(claim(2, 2, 0), [game(1, 5, 1), game(2, 5, 1)])).toEqual([]);
    expect(errors(claim(2, 0, 2), [game(1, 5, 1), game(2, 5, 1)])).toContain("series_claim_mismatch");
    expect(errors(claim(3, 2, 1), [game(1, 5, 1)])).toEqual([]);
  });

  it("counts only the games the live seats played after a participation takeover", () => {
    // Seat A was taken over by C: the two confirmed games it played were
    // retired with it, so the server counts none of them (`confirmed_game_lines`).
    const C = 12;
    const retired = [game(1, 5, 1), game(2, 5, 1)];
    const live = (gamesPlayed: number, c: number, b: number) =>
      seriesClaimErrors({
        preset: "wins",
        bestOf: 3,
        teamIds: [C, B],
        games: retired,
        claim: { gamesPlayed, totals: { [C]: c, [B]: b }, wins: { [C]: c, [B]: b } }
      });
    // Not "fewer games than are confirmed", not "fewer wins than A won", not a
    // totals mismatch against games nobody on the card played.
    expect(live(2, 0, 2)).toEqual([]);
    expect(live(2, 2, 0)).toEqual([]);
  });

  it("credits a win only to a sole first place", () => {
    const placed = game(1, 5, 1);
    placed.teams[0].placement = 2;
    placed.teams[1].placement = 3;
    expect(errors(claim(2, 0, 2), [placed])).not.toContain("series_claim_wins");
    expect(errors(claim(2, 0, 2), [placed, game(2, 5, 1)])).toContain("series_claim_wins");
  });

  it("names the encounter's teams", () => {
    expect(
      seriesClaimErrors({
        preset: "wins",
        bestOf: 3,
        teamIds: [A, B],
        games: [],
        claim: { gamesPlayed: 2, totals: { [A]: 2 }, wins: null }
      })
    ).toContain("series_claim_teams");
  });
});

describe("encounterEnded", () => {
  it("a lobby's card ends only when every game is played", () => {
    expect(encounterEnded("points", { bestOf: 3, games: 2, maxWins: 2 })).toBe(false);
    expect(encounterEnded("points", { bestOf: 3, games: 3, maxWins: 0 })).toBe(true);
  });
});

describe("seriesReportErrorCodes", () => {
  it("keeps only the codes the form words", () => {
    const error = new ApiError(409, [
      { msg: "x", code: "stale_state" },
      { msg: "y", code: "something_else" }
    ]);
    expect(seriesReportErrorCodes(error)).toEqual(["stale_state"]);
    expect(seriesReportErrorCodes(new Error("boom"))).toEqual([]);
  });
});
